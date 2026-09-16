package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	nethtml "golang.org/x/net/html"
)

const (
	maxHTMLBytes = 8 << 20
	maxBodyBytes = 32 << 20
	sessionCookie = "ly_session"
)

type sessionStore struct {
	mu    sync.Mutex
	jars  map[string]http.CookieJar
	last  map[string]time.Time
	ttl   time.Duration
}

func newSessionStore(ttl time.Duration) *sessionStore {
	return &sessionStore{jars: make(map[string]http.CookieJar), last: make(map[string]time.Time), ttl: ttl}
}

func (s *sessionStore) get(id string) http.CookieJar {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if jar := s.jars[id]; jar != nil && now.Sub(s.last[id]) < s.ttl {
		s.last[id] = now
		return jar
	}
	jar, _ := cookiejar.New(nil)
	s.jars[id] = jar
	s.last[id] = now
	return jar
}

func main() {
	addr := getenv("LISTEN_ADDR", ":8080")
	webOrigin := getenv("WEB_ORIGIN", "*")
	store := newSessionStore(7 * 24 * time.Hour)

	transport := &http.Transport{
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   32,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 25 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DialContext:           safeDialContext,
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   50 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 8 {
				return http.ErrUseLastResponse
			}
			return validateTarget(req.URL)
		},
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		setCORS(w, webOrigin)
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, `{"ok":true,"service":"lyrenthos-gateway","mode":"http-proxy"}`)
	})

	mux.HandleFunc("/proxy", func(w http.ResponseWriter, r *http.Request) {
		setCORS(w, webOrigin)
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "GET and HEAD are supported in this release", http.StatusMethodNotAllowed)
			return
		}

		targetRaw := r.URL.Query().Get("url")
		if targetRaw == "" || len(targetRaw) > 8192 {
			http.Error(w, "missing or invalid url", http.StatusBadRequest)
			return
		}
		target, err := url.Parse(targetRaw)
		if err != nil || validateTarget(target) != nil {
			http.Error(w, "invalid or blocked target", http.StatusBadRequest)
			return
		}

		sid := sessionID(r)
		if sid == "" {
			sid = newSessionID()
			http.SetCookie(w, &http.Cookie{
			Name:     sessionCookie,
			Value:    sid,
			Path:     "/",
			Secure:   true,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   60 * 60 * 24 * 30,
		})
		}

		jar := store.get(sid)
		upstream, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), nil)
		if err != nil {
			http.Error(w, "could not create upstream request", http.StatusBadGateway)
			return
		}
		copyRequestHeaders(upstream.Header, r.Header)
		upstream.Header.Set("User-Agent", browserUserAgent())
		upstream.Header.Set("Accept", acceptHeader(r.Header.Get("Accept")))
		if language := r.Header.Get("Accept-Language"); language != "" {
			upstream.Header.Set("Accept-Language", language)
		}
		upstream.Header.Set("Accept-Encoding", "gzip")

		for _, c := range jar.Cookies(target) {
			upstream.AddCookie(c)
		}

		response, err := client.Do(upstream)
		if err != nil {
			http.Error(w, "upstream request failed", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		jar.SetCookies(target, response.Cookies())

		copyResponseHeaders(w.Header(), response.Header)
		w.Header().Del("Set-Cookie")
		w.Header().Del("Content-Length")
		if location := response.Header.Get("Location"); location != "" {
			resolved := resolveRelative(target, location)
			if resolved != "" {
				w.Header().Set("Location", proxyLocation(resolved))
			} else {
				w.Header().Del("Location")
			}
		}

		w.WriteHeader(response.StatusCode)
		if r.Method == http.MethodHead {
			return
		}

		contentType := strings.ToLower(response.Header.Get("Content-Type"))
		if strings.Contains(contentType, "text/html") {
			body, err := io.ReadAll(io.LimitReader(response.Body, maxHTMLBytes+1))
			if err != nil {
				return
			}
			if len(body) > maxHTMLBytes {
				http.Error(w, "upstream HTML is too large for rewriting", http.StatusBadGateway)
				return
			}
			rewritten, err := rewriteHTML(body, target)
			if err == nil {
				_, _ = w.Write(rewritten)
			} else {
				_, _ = w.Write(body)
			}
			return
		}

		_, _ = io.CopyBuffer(w, io.LimitReader(response.Body, maxBodyBytes), make([]byte, 32*1024))
	})

	server := &http.Server{
		Addr:              addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	log.Printf("lyrenthos gateway listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func sessionID(r *http.Request) string {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || len(cookie.Value) < 32 || len(cookie.Value) > 128 {
		return ""
	}
	return cookie.Value
}

func newSessionID() string {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d-%d", time.Now().UnixNano(), os.Getpid())
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func validateTarget(u *url.URL) error {
	if u == nil || u.Hostname() == "" {
		return fmt.Errorf("missing host")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("scheme not allowed")
	}
	if strings.ContainsAny(u.Hostname(), "\\r\\n") {
		return fmt.Errorf("invalid hostname")
	}
	if p := u.Port(); p != "" && !validPort(p) {
		return fmt.Errorf("invalid port")
	}
	return validateHost(u.Hostname())
}

func validPort(value string) bool {
	p, err := strconv.Atoi(value)
	return err == nil && p >= 1 && p <= 65535
}

func validateHost(host string) error {
	if ip := net.ParseIP(host); ip != nil {
		if blockedIP(ip) {
			return fmt.Errorf("blocked address")
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return fmt.Errorf("host resolution failed")
	}
	for _, addr := range ips {
		if blockedIP(addr.IP) {
			return fmt.Errorf("host resolves to blocked address")
		}
	}
	return nil
}

func safeDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return nil, fmt.Errorf("host resolution failed")
	}
	dialer := &net.Dialer{Timeout: 8 * time.Second, KeepAlive: 30 * time.Second}
	var lastErr error
	for _, item := range ips {
		if blockedIP(item.IP) {
			lastErr = fmt.Errorf("blocked address")
			continue
		}
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(item.IP.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no reachable address")
	}
	return nil, lastErr
}

func blockedIP(ip net.IP) bool {
	return ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()
}

func copyRequestHeaders(dst, src http.Header) {
	for key, values := range src {
		lk := strings.ToLower(key)
		if lk == "host" || lk == "content-length" || lk == "connection" || lk == "cookie" || lk == "origin" || lk == "referer" || lk == "accept-encoding" {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func copyResponseHeaders(dst, src http.Header) {
	blocked := map[string]bool{
		"connection":        true,
		"content-length":    true,
		"transfer-encoding": true,
		"set-cookie":        true,
	}
	for key, values := range src {
		if blocked[strings.ToLower(key)] {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func rewriteHTML(input []byte, base *url.URL) ([]byte, error) {
	doc, err := nethtml.Parse(strings.NewReader(string(input)))
	if err != nil {
		return nil, err
	}
	walkAndRewrite(doc, base)
	var out strings.Builder
	if err := nethtml.Render(&out, doc); err != nil {
		return nil, err
	}
	return []byte(out.String()), nil
}

func walkAndRewrite(node *nethtml.Node, base *url.URL) {
	if node.Type == nethtml.ElementNode {
		for i := range node.Attr {
			name := strings.ToLower(node.Attr[i].Key)
			if name != "href" && name != "src" && name != "action" && name != "poster" && name != "data" {
				continue
			}
			value := strings.TrimSpace(node.Attr[i].Val)
			lower := strings.ToLower(value)
			if value == "" || strings.HasPrefix(value, "#") || strings.HasPrefix(lower, "javascript:") || strings.HasPrefix(lower, "data:") || strings.HasPrefix(lower, "mailto:") || strings.HasPrefix(lower, "tel:") {
				continue
			}
			resolved := resolveRelative(base, value)
			if resolved != "" {
				node.Attr[i].Val = proxyLocation(resolved)
			}
		}
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		walkAndRewrite(child, base)
	}
}

func resolveRelative(base *url.URL, value string) string {
	ref, err := url.Parse(value)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(ref)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}
	// Do not DNS-resolve every asset during HTML rewriting. The dialer performs
	// the SSRF-safe resolution immediately before the actual network connection.
	if resolved.Hostname() == "" || strings.ContainsAny(resolved.Hostname(), "\\r\\n") {
		return ""
	}
	return resolved.String()
}

func proxyLocation(target string) string {
	return "/proxy?url=" + url.QueryEscape(target)
}

func acceptHeader(value string) string {
	if value == "" {
		return "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
	}
	return value
}

func browserUserAgent() string {
	return getenv("UPSTREAM_USER_AGENT", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 LyrenthosGateway/0.2")
}

func setCORS(w http.ResponseWriter, origin string) {
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
