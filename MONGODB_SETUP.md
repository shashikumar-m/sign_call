# Install & configure MongoDB on your EC2 Ubuntu instance

## Install MongoDB 7 (Ubuntu 22.04)
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

## Start and enable MongoDB
sudo systemctl start  mongod
sudo systemctl enable mongod
sudo systemctl status mongod

## Verify it's running
mongosh --eval "db.adminCommand({ ping: 1 })"
# Should print: { ok: 1 }

## Create .env on EC2
cp /home/ubuntu/sign_call/server/.env.example /home/ubuntu/sign_call/server/.env
nano /home/ubuntu/sign_call/server/.env
# Set:
#   MONGODB_URI=mongodb://localhost:27017/sign_call
#   JWT_SECRET=some-very-long-random-secret-string-here

## Install dependencies and restart
cd /home/ubuntu/sign_call/server
npm install
pm2 restart signconnect

## Check it works
curl http://localhost:3000/health
# Should show: { "status":"ok", "mongodb":"connected", ... }
