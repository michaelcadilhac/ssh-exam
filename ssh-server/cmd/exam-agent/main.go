package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"examworkspace/agent/internal/core"
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	configPath := flag.String("config", "/etc/exam-agent/agent.json", "configuration")
	watch := flag.Bool("watchdog", false, "independent deadline watchdog")
	once := flag.Bool("reconcile", false, "reconcile once")
	flag.Parse()
	c, err := core.LoadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	e, err := core.New(c)
	if err != nil {
		log.Fatal(err)
	}
	if *once {
		if err = e.Tick(); err != nil {
			log.Fatal(err)
		}
		return
	}
	if *watch {
		e.Watch()
		return
	}
	if err = e.Tick(); err != nil {
		log.Fatal(err)
	}
	go func() { log.Fatal(e.ServeLocal()) }()
	ca, err := os.ReadFile(c.CA)
	if err != nil {
		log.Fatal(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		log.Fatal("invalid client CA")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/", func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || r.TLS.PeerCertificates[0].Subject.CommonName != c.ClientName {
			http.Error(w, "control identity rejected", 403)
			return
		}
		op := strings.TrimPrefix(r.URL.Path, "/v1/")
		if strings.HasPrefix(op, "export/") && r.Method == "GET" {
			id := strings.TrimPrefix(op, "export/")
			status, err := e.Call("submission-status", core.Request{ID: id})
			if err != nil || !status.(*core.Attempt).Protected {
				http.Error(w, "submission unavailable", 409)
				return
			}
			if _, err = e.Call("submission-manifest", core.Request{ID: id}); err != nil {
				http.Error(w, "protected submission verification failed", 409)
				return
			}
			w.Header().Set("Content-Type", "application/gzip")
			http.ServeFile(w, r, filepath.Join(c.State, "submissions", id, "submission.tar.gz"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4*1024*1024)
		var input core.Request
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&input); err != nil {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid typed request"})
			return
		}
		result, err := e.Call(op, input)
		if err != nil {
			w.WriteHeader(409)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(result)
	})
	server := &http.Server{Addr: c.Listen, Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 75 * time.Second, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool}}
	log.Fatal(server.ListenAndServeTLS(c.Cert, c.Key))
}
