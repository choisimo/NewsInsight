package main

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Password storage table minimal (added via migrate extension)
// We'll extend migrate to include passwords if not there.

func init() {
	// extend migrations lazily if store already opened later.
}

// Add password column if missing (SQLite pragma check could be added; simplified here)
func ensurePasswordSchema(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS passwords (user_id INTEGER UNIQUE, hash TEXT)`)
	return err
}

// Create user with password (admin only future)
func (s *Store) CreateUser(email, name, password string) (*User, error) {
	if email == "" { return nil, errors.New("email required") }
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil { return nil, err }
	_, err = s.DB.Exec(`INSERT INTO users(email,name,created_at,active) VALUES (?,?,?,1)`, email, name, time.Now())
	if err != nil { return nil, err }
	var uid int64
	if err := s.DB.QueryRow(`SELECT id FROM users WHERE email=?`, email).Scan(&uid); err != nil { return nil, err }
	if _, err := s.DB.Exec(`INSERT INTO passwords(user_id,hash) VALUES (?,?)`, uid, string(h)); err != nil { return nil, err }
	return &User{ID: uid, Email: email, Name: name, CreatedAt: time.Now(), Active: true}, nil
}

func (s *Store) AuthenticateUser(email, password string) (*User, error) {
	var uid int64
	var name string
	var active bool
	if err := s.DB.QueryRow(`SELECT id,name,active FROM users WHERE email=?`, email).Scan(&uid, &name, &active); err != nil { return nil, errors.New("invalid credentials") }
	if !active { return nil, errors.New("inactive user") }
	var hash string
	if err := s.DB.QueryRow(`SELECT hash FROM passwords WHERE user_id=?`, uid).Scan(&hash); err != nil { return nil, errors.New("invalid credentials") }
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil { return nil, errors.New("invalid credentials") }
	return &User{ID: uid, Email: email, Name: name, Active: active}, nil
}

// Policy evaluation
func (s *Store) Allowed(subject string, action string, resource string) (bool, error) {
	// Wildcard match precedence: if any policy for subject grants * then allow.
	rows, err := s.DB.Query(`SELECT action, resource FROM policies WHERE subject=?`, subject)
	if err != nil { return false, err }
	defer rows.Close()
	allowed := false
	for rows.Next() {
		var act, res string
		if err := rows.Scan(&act, &res); err != nil { return false, err }
		if (act == action || act == "*") && (res == resource || res == "*") { allowed = true; break }
	}
	return allowed, nil
}

// Expand subject list (roles + direct user) for evaluation
func (s *Store) SubjectsForUser(uid int64) ([]string, error) {
	subs := []string{"user:" + intToString(uid)}
	rows, err := s.DB.Query(`SELECT r.name FROM roles r JOIN user_roles ur ON r.id=ur.role_id WHERE ur.user_id=?`, uid)
	if err != nil { return subs, err }
	defer rows.Close()
	for rows.Next() { var name string; if rows.Scan(&name) == nil { subs = append(subs, "role:"+name) } }
	return subs, nil
}

func intToString(i int64) string { return fmt.Sprintf("%d", i) }
