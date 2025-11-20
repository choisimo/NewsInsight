package main

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	_ "github.com/glebarez/sqlite"
)

type Store struct {
	DB *sql.DB
}

type User struct {
	ID        int64     `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	Active    bool      `json:"active"`
}

type Role struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type Policy struct {
	ID       int64  `json:"id"`
	Subject  string `json:"subject"` // role:<name> or user:<id>
	Action   string `json:"action"`  // e.g. token:create, proxy:invoke
	Resource string `json:"resource"` // e.g. upstream:default or model:gpt-4.1
}

func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil { return nil, err }
	if err := migrate(db); err != nil { return nil, err }
	return &Store{DB: db}, nil
}

func migrate(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, name TEXT, created_at TIMESTAMP, active BOOLEAN DEFAULT 1);`,
		`CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);`,
		`CREATE TABLE IF NOT EXISTS user_roles (user_id INTEGER, role_id INTEGER, UNIQUE(user_id, role_id));`,
		`CREATE TABLE IF NOT EXISTS policies (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, action TEXT, resource TEXT);`,
		`CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, name TEXT, scopes TEXT, expires_at INTEGER, revoked BOOLEAN DEFAULT 0, user_id INTEGER);`,
		`CREATE TABLE IF NOT EXISTS passwords (user_id INTEGER UNIQUE, hash TEXT);`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil { return err }
	}
	return nil
}

func (s *Store) SeedBootstrapAdmin(userEmail string) error {
	if userEmail == "" { userEmail = "admin@example.com" }
	// Create admin role if not exists
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO roles(name) VALUES (?)`, "admin"); err != nil { return err }
	// Create user if not exists
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO users(email, name, created_at, active) VALUES (?,?,?,1)`, userEmail, "Admin", time.Now()); err != nil { return err }
	// Link user to admin role
	var uid int64
	if err := s.DB.QueryRow(`SELECT id FROM users WHERE email=?`, userEmail).Scan(&uid); err != nil { return err }
	var rid int64
	if err := s.DB.QueryRow(`SELECT id FROM roles WHERE name='admin'`).Scan(&rid); err != nil { return err }
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES (?,?)`, uid, rid); err != nil { return err }
	// Seed broad policies for admin (only if absent to avoid duplicates)
	pols := []struct{A,R string}{
		{"*","*"}, // wildcard action/resource for admin convenience
	}
	for _, p := range pols {
		// naive duplicate avoidance: count existing identical policy
		var cnt int
		if err := s.DB.QueryRow(`SELECT COUNT(1) FROM policies WHERE subject=? AND action=? AND resource=?`, "role:admin", p.A, p.R).Scan(&cnt); err == nil && cnt == 0 {
			if _, err := s.DB.Exec(`INSERT INTO policies(subject, action, resource) VALUES (?,?,?)`, "role:admin", p.A, p.R); err != nil { return err }
		}
	}
	return nil
}

// Token persistence helpers
func (s *Store) SaveToken(t *Token, userID *int64) error {
	if t == nil { return errors.New("nil token") }
	scopes := stringsJoin(t.Scopes, ",")
	var uid any
	if userID != nil { uid = *userID } else { uid = nil }
	_, err := s.DB.Exec(`INSERT INTO tokens(id,name,scopes,expires_at,revoked,user_id) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, scopes=excluded.scopes, expires_at=excluded.expires_at, revoked=excluded.revoked, user_id=excluded.user_id`, t.ID, t.Name, scopes, t.ExpiresAt, t.Revoked, uid)
	return err
}

func (s *Store) LoadToken(id string) (*Token, error) {
	row := s.DB.QueryRow(`SELECT id,name,scopes,expires_at,revoked FROM tokens WHERE id=?`, id)
	var tk Token
	var scopes string
	if err := row.Scan(&tk.ID, &tk.Name, &scopes, &tk.ExpiresAt, &tk.Revoked); err != nil { return nil, err }
	if scopes != "" { tk.Scopes = stringsSplit(scopes, ",") }
	return &tk, nil
}

func (s *Store) ListTokens() ([]*Token, error) {
	rows, err := s.DB.Query(`SELECT id,name,scopes,expires_at,revoked FROM tokens`)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []*Token
	for rows.Next() {
		var tk Token
		var scopes string
		if err := rows.Scan(&tk.ID, &tk.Name, &scopes, &tk.ExpiresAt, &tk.Revoked); err != nil { return nil, err }
		if scopes != "" { tk.Scopes = stringsSplit(scopes, ",") }
		out = append(out, &tk)
	}
	return out, nil
}

func stringsJoin(ss []string, sep string) string {
	if len(ss) == 0 { return "" }
	out := ss[0]
	for i := 1; i < len(ss); i++ { out += sep + ss[i] }
	return out
}
func stringsSplit(s, sep string) []string {
	if s == "" { return nil }
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" { out = append(out, p) }
	}
	return out
}
