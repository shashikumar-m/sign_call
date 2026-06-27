# SignConnect — AWS EC2 Deployment Guide

## Architecture
```
Browser A ──WebRTC (P2P)──► Browser B
     │                           │
     └──Socket.io signaling──────┘
              │
         EC2 Server
         (Node.js + Express + Socket.io)
         Serves static files + handles signaling
```

---

## Step 1 — Launch EC2 Instance

- **AMI**: Ubuntu 22.04 LTS (free tier eligible)
- **Instance type**: t2.micro (free) or t3.small for better performance
- **Security Group — open these ports**:
  | Port | Protocol | Source     | Purpose                |
  |------|----------|------------|------------------------|
  | 22   | TCP      | Your IP    | SSH                    |
  | 80   | TCP      | 0.0.0.0/0  | HTTP                   |
  | 443  | TCP      | 0.0.0.0/0  | HTTPS (after SSL)      |
  | 3000 | TCP      | 0.0.0.0/0  | Node.js server         |

---

## Step 2 — Connect to EC2 and Install Node.js

```bash
# SSH into your instance
ssh -i your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install git
sudo apt-get install -y git

# Verify
node --version   # should show v18.x
npm --version
```

---

## Step 3 — Upload the Project

### Option A — Git (recommended)
```bash
# On EC2
git clone https://github.com/YOUR_USERNAME/signconnect.git
cd signconnect
```

### Option B — SCP from your Windows machine
```powershell
# Run from your local machine (PowerShell)
scp -i your-key.pem -r "S:\project2\major project2\*" ubuntu@YOUR_EC2_IP:/home/ubuntu/signconnect/
```

---

## Step 4 — Install Dependencies and Start

```bash
cd /home/ubuntu/signconnect/server
npm install

# Test it runs
node server.js
# You should see: ✋ SignConnect server running  http://0.0.0.0:3000
# Press Ctrl+C
```

---

## Step 5 — Run with PM2 (keeps it running 24/7)

```bash
# Install PM2
sudo npm install -g pm2

# Start the server
cd /home/ubuntu/signconnect/server
pm2 start server.js --name signconnect

# Auto-start on reboot
pm2 startup
pm2 save

# Check status
pm2 status
pm2 logs signconnect
```

---

## Step 6 — Set up Nginx reverse proxy (port 80 → 3000)

```bash
sudo apt-get install -y nginx

sudo tee /etc/nginx/sites-available/signconnect << 'EOF'
server {
    listen 80;
    server_name YOUR_EC2_IP_OR_DOMAIN;

    # Increase timeouts for long-lived WebSocket connections
    proxy_read_timeout   3600;
    proxy_send_timeout   3600;
    proxy_connect_timeout 60;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/signconnect /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Now visit **http://YOUR_EC2_IP** — the app is live!

---

## Step 7 — HTTPS with SSL (REQUIRED for camera access)

> Browsers block `getUserMedia()` on non-HTTPS pages (except localhost).
> You MUST set up SSL for the webcam + microphone to work in production.

### Option A — Free domain + Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get certificate (replace with your domain)
sudo certbot --nginx -d yourdomain.com

# Auto-renew
sudo certbot renew --dry-run
```

Update nginx config to use your domain name.

### Option B — Self-signed cert (testing only)

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/signconnect.key \
  -out /etc/ssl/certs/signconnect.crt \
  -subj "/C=IN/ST=State/L=City/O=SignConnect/CN=YOUR_EC2_IP"
```

---

## Step 8 — Test the Full Flow

1. Open **https://YOUR_DOMAIN** in **Chrome** (User A)
2. Create an account, add User B as contact
3. Open the same URL in another browser/device (User B)
4. Create a second account
5. User A starts a video call → User B opens the link
6. Both should see each other's video live ✅
7. Sign a gesture (ASL "Hello") → caption appears on other side ✅
8. Click Speech button → speak → captions appear in real time ✅

---

## Useful commands

```bash
# View server logs live
pm2 logs signconnect

# Restart after code update
cd /home/ubuntu/signconnect/server
git pull
pm2 restart signconnect

# Check health endpoint
curl http://localhost:3000/health
```

---

## How the video call works (technical)

```
1. User A opens call.html?cid=userB_id
2. call.js connects to Socket.io on same origin
3. Emits join-room with roomId = sorted(userA_id:userB_id)
4. Server says "you're first" — User A waits

5. User B opens the same call from their device
6. Server says "User A is already here"
7. User A creates RTCPeerConnection + SDP Offer
8. Offer sent via Socket.io to User B
9. User B creates answer, sends back
10. Both exchange ICE candidates via Socket.io
11. WebRTC P2P connection established ✅
12. Video/audio streams directly between browsers
    (NOT through server — server only handles signaling)

13. When User A signs a gesture:
    - MediaPipe detects it locally
    - Gesture name sent via socket to room
    - User B's browser shows the caption bubble
    - Text-to-speech speaks the gesture aloud

14. When User A speaks:
    - SpeechRecognition API transcribes locally
    - Text sent via socket to room
    - User B sees captions in real time
```
