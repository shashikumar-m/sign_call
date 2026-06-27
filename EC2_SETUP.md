# sign_call — EC2 Setup & Fix Guide
# Your project is at: /home/ubuntu/sign_call/
# Server is at:       /home/ubuntu/sign_call/server/server.js
# PM2 process name:   signconnect (id: 6)

## ─────────────────────────────────────────────────────────────
## STEP 1 — Check server is actually serving your files
## ─────────────────────────────────────────────────────────────

# On EC2, run:
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","rooms":0,"sockets":0,"uptime":...}

# If you get "Connection refused" — restart PM2:
pm2 restart signconnect
pm2 logs signconnect --lines 20


## ─────────────────────────────────────────────────────────────
## STEP 2 — Set up Nginx (if not done yet)
## ─────────────────────────────────────────────────────────────

sudo apt-get install -y nginx

sudo tee /etc/nginx/sites-available/sign_call << 'NGINXEOF'
server {
    listen 80;
    server_name _;

    # Critical for WebSocket / Socket.io
    proxy_read_timeout    86400;
    proxy_send_timeout    86400;
    proxy_connect_timeout 60;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINXEOF

# Enable it
sudo ln -sf /etc/nginx/sites-available/sign_call /etc/nginx/sites-enabled/sign_call
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Test via public IP
curl http://YOUR_EC2_PUBLIC_IP/health


## ─────────────────────────────────────────────────────────────
## STEP 3 — HTTPS with SSL (REQUIRED for camera/mic to work!)
## ─────────────────────────────────────────────────────────────
# Browsers BLOCK getUserMedia() on plain HTTP.
# You need HTTPS. Two options:

### Option A — You have a domain (best)
sudo apt install certbot python3-certbot-nginx -y
# Edit nginx config to use your domain first, then:
sudo certbot --nginx -d yourdomain.com

### Option B — No domain, use self-signed cert (for testing)
# This will show a browser warning — click "Advanced > Proceed"
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/sign_call.key \
  -out    /etc/ssl/certs/sign_call.crt \
  -subj "/C=IN/ST=India/L=City/O=SignCall/CN=YOUR_EC2_IP"

# Then update nginx:
sudo tee /etc/nginx/sites-available/sign_call << 'NGINXEOF'
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/ssl/certs/sign_call.crt;
    ssl_certificate_key /etc/ssl/private/sign_call.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    proxy_read_timeout    86400;
    proxy_send_timeout    86400;
    proxy_connect_timeout 60;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINXEOF

sudo nginx -t && sudo systemctl reload nginx


## ─────────────────────────────────────────────────────────────
## STEP 4 — EC2 Security Group ports (AWS Console)
## ─────────────────────────────────────────────────────────────
# Go to: EC2 → Instances → Your Instance → Security → Security Groups
# Add these Inbound Rules:
#
#  Type        Port   Source
#  ─────────────────────────────
#  SSH         22     Your IP
#  HTTP        80     0.0.0.0/0
#  HTTPS       443    0.0.0.0/0
#  Custom TCP  3000   0.0.0.0/0  (direct access during testing)


## ─────────────────────────────────────────────────────────────
## STEP 5 — Upload latest code changes
## ─────────────────────────────────────────────────────────────
# From your Windows machine (PowerShell):
scp -i "your-key.pem" -r "S:\project2\major project2\js\call.js" ubuntu@YOUR_EC2_IP:/home/ubuntu/sign_call/js/
scp -i "your-key.pem" -r "S:\project2\major project2\server\server.js" ubuntu@YOUR_EC2_IP:/home/ubuntu/sign_call/server/

# Then on EC2 restart PM2:
pm2 restart signconnect


## ─────────────────────────────────────────────────────────────
## STEP 6 — Test the complete flow
## ─────────────────────────────────────────────────────────────
# 1. Open https://YOUR_EC2_IP in Chrome (Browser / Device A)
#    - Ignore SSL warning if self-signed: click Advanced > Proceed
# 2. Sign up as User A
# 3. Open the same URL in another browser or phone (Browser B)  
# 4. Sign up as User B
# 5. User A: search for User B → Add Contact
# 6. User A: click 📹 Video Call
# 7. User B: open the app → should see incoming call notification
#    (or both manually open call.html?cid=<other_user_id>&mode=video)
# 8. Both should see each other's live video ✅
# 9. User A signs "Hello" → caption appears on User B's screen ✅
# 10. Click Speech button → speak → captions appear in real time ✅


## ─────────────────────────────────────────────────────────────
## TROUBLESHOOTING
## ─────────────────────────────────────────────────────────────

### Camera/mic not working?
# → You MUST use HTTPS (step 3). Plain HTTP blocks camera in Chrome.

### Socket.io not connecting?
# → Check: curl http://localhost:3000/socket.io/socket.io.js
# → Should return JS code. If 404 — server not running.
# → Run: pm2 logs signconnect

### Video call connects but no remote video?
# → WebRTC ICE candidates need UDP ports. Add to Security Group:
#    Custom UDP  10000-65535  0.0.0.0/0
# → Or add a TURN server in call.js ICE_SERVERS config.

### Two instances of PM2 with same name (accesscall)?
# → Stop duplicates: pm2 delete 5  (delete the newer one)
# → Keep only the one with more uptime.

### Check all PM2 processes:
pm2 list
pm2 logs signconnect --lines 50


## ─────────────────────────────────────────────────────────────
## QUICK COMMANDS REFERENCE
## ─────────────────────────────────────────────────────────────
pm2 status                          # see all processes
pm2 logs signconnect                # live logs
pm2 restart signconnect             # restart after code update
pm2 stop signconnect                # stop
pm2 delete signconnect              # remove from PM2
curl http://localhost:3000/health   # health check
sudo systemctl status nginx         # nginx status
sudo nginx -t                       # test nginx config
