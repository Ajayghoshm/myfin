# Phone share app (PWA)

Share a PhonePe statement from your Android phone straight into MyFin's import screen.

## One-time laptop setup
1. `brew install mkcert && mkcert -install`
2. In `myfin-api/`: `mkdir certs && mkcert -cert-file certs/share.pem -key-file certs/share-key.pem <laptop-LAN-IP> localhost`
3. Add to `myfin-api/.env`:
   ```
   SHARE_TOKEN=<pick a long random string>
   SHARE_TLS_CERT=./certs/share.pem
   SHARE_TLS_KEY=./certs/share-key.pem
   # optional: SHARE_HTTPS_PORT=3443, SHARE_INBOX_DIR=./share-inbox
   ```
4. Restart the API (allow port 3443 through the macOS firewall).

## One-time phone setup
1. Copy the mkcert root CA (`mkcert -CAROOT`, file `rootCA.pem`) to the phone and install it
   (Settings > Security > Encryption & credentials > Install a certificate > CA certificate).
2. In Chrome open `https://<laptop-LAN-IP>:3443/share/` > menu > Install app.
3. Open the app, expand "Pairing token", paste `SHARE_TOKEN`, Save.

## Daily use
PhonePe/Files > Share > MyFin Share. The file is sent immediately if the laptop is reachable,
otherwise it waits on the phone (open the app on the same Wi-Fi to flush it).
On the laptop: Transactions > Import > "Received from your phone" > click the file.
Re-importing the same statement is safe (duplicates are detected); use the bin icon to clear files.
