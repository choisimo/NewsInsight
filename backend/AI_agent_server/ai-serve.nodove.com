upstream ai_backend {
    server localhost:7015;
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

map $http_x_internal_gateway_key $is_authorized {
    default 0;
    "f4f01b9225277911696f0b5121bfd8cc5d4f0659970da527f4e9f8350604e80f" 1;
}


server {
  listen 80;
  listen [::]:80;
  server_name ai-serve.nodove.com;

  location ^~ /.well-known/acme-challenge/ {
    allow all;
    root /var/www/html;
  }

  return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ai-serve.nodove.com;

    ssl_certificate /etc/letsencrypt/live/nodove.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nodove.com/privkey.pem;

    # SSL 보안 강화 설정
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;

    # 보안 헤더들
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://api.openai.com https://ai-check.nodove.com wss://ai-check.nodove.com wss://ai-serve.nodove.com; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline';" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    # 프록시 설정
    location ~ ^/(session|event|app|config|agent) {
        if ($is_authorized = 0) { return 403; }
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        gzip off;
        proxy_set_header Accept-Encoding "";
        real_ip_header CF-Connecting-IP;
    }

    location / {
        if ($is_authorized = 0) { return 403; }
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_set_header Accept-Encoding "";
        real_ip_header CF-Connecting-IP;
    }
}

