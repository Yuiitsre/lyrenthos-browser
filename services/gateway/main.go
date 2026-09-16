package main

import (
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func main() {
	addr := getenv("LISTEN_ADDR", ":8080")
	client := &http.Client{Timeout: 45 * time.Second}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"service":"lyrenthos-gateway"}`))
	})

	mux.HandleFunc("/proxy", func(w http.ResponseWriter, r *http.Request) {
		target := r.URL.Query().Get("url")
		if target == "" {
			http.Error(w, "missing url query parameter", http.StatusBadRequest)
			return
		}

		u, err := url.ParseRequestURI(target)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			http.Error(w, "invalid target URL", http.StatusBadRequest)
			return
		}

		// Production requirements before exposing this endpoint publicly:
		// - authenticate the caller and bind the gateway session to that user
		// - block localhost/private/link-local/reserved destinations (SSRF defense)
		// - enforce destination policy and DNS-rebinding protection
		// - isolate cookies per user/session
		// - rewrite Location/HTML/CSS resource URLs
		// - implement WebSocket tunneling
		// - add request/body/response size limits, rate limits and observability
		req, err := http.NewRequestWithContext(r.Context(), r.Method, u.String(), r.Body)
		if err != nil {
			http.Error(w, "could not create upstream request", http.StatusBadGateway)
			return
		}
		copyRequestHeaders(req.Header, r.Header)
		req.Header.Set("Accept-Encoding", "gzip")

		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "upstream request failed", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		copyResponseHeaders(w.Header(), resp.Header)
		w.Header().Del("Content-Length")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.CopyBuffer(w, resp.Body, make([]byte, 32*1024))
	})

	server := &http.Server{
		Addr:              addr,
		Handler:           withBasicSecurityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	log.Printf("lyrenthos gateway listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func withBasicSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		next.ServeHTTP(w, r)
	})
}

func copyRequestHeaders(dst, src http.Header) {
	for k, values := range src {
		lk := strings.ToLower(k)
		if lk == "host" || lk == "content-length" || lk == "connection" || lk == "accept-encoding" {
			continue
		}
		for _, v := range values {
			dst.Add(k, v)
		}
	}
}

func copyResponseHeaders(dst, src http.Header) {
	for k, values := range src {
		lk := strings.ToLower(k)
		if lk == "connection" || lk == "content-length" || lk == "transfer-encoding" {
			continue
		}
		for _, v := range values {
			dst.Add(k, v)
		}
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
