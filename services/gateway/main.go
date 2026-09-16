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

// MVP gateway skeleton. The production version should add strict target allow-lists,
// authentication, cookie isolation, response URL rewriting, WebSocket support,
// limits, observability and SSRF protections before deployment.
func main() {
	addr := getenv("LISTEN_ADDR", ":8080")
	client := &http.Client{Timeout: 45 * time.Second}

	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodConnect {
			http.Error(w, "CONNECT is not supported by the MVP", http.StatusNotImplemented)
			return
		}

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

		// IMPORTANT: add destination allow/deny policy and SSRF protections before
		// allowing arbitrary user-controlled targets in production.
		req, err := http.NewRequestWithContext(r.Context(), r.Method, u.String(), r.Body)
		if err != nil {
			http.Error(w, "could not create upstream request", http.StatusBadGateway)
			return
		}

		copyRequestHeaders(req.Header, r.Header)
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}

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

	log.Printf("lyrenthos gateway listening on %s", addr)
	if err := http.ListenAndServe(addr, h); err != nil {
		log.Fatal(err)
	}
}

func copyRequestHeaders(dst, src http.Header) {
	for k, values := range src {
		lk := strings.ToLower(k)
		if lk == "host" || lk == "content-length" || lk == "connection" {
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
