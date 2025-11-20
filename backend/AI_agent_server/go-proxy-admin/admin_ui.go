package main

import (
	"embed"
	"net/http"
)

//go:embed static/*
var staticFS embed.FS

func init() {
	http.Handle("/admin/ui/", http.StripPrefix("/admin/ui/", http.FileServer(http.FS(staticFS))))
}
