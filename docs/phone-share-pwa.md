# Phone share app (PWA)

Share a PhonePe statement from your Android phone straight into MyFin's import screen.

The phone always talks to the laptop's stable Bonjour name (e.g. `https://EL-LM-001.local:3443`), so
a changing router IP does not matter. Find yours with `scutil --get LocalHostName` (add `.local`).

## One-time laptop setup
1. `brew install mkcert && mkcert -install`
2. In `myfin-api/`: `mkdir certs && mkcert -cert-file certs/share.pem -key-file certs/share-key.pem <LocalHostName>.local localhost`
3. Add to `myfin-api/.env`:
   ```
   SHARE_TLS_CERT=./certs/share.pem
   SHARE_TLS_KEY=./certs/share-key.pem
   # optional: SHARE_HTTPS_PORT=3443, SHARE_INBOX_DIR=./share-inbox
   # optional: SHARE_PUBLIC_URL=https://<name>.local:3443 (if the auto-detected name is wrong)
   ```
4. Restart the API (allow port 3443 through the macOS firewall).

## One-time phone setup
1. Copy the mkcert root CA (`mkcert -CAROOT`, file `rootCA.pem`) to the phone and install it
   (Settings > Security > Encryption & credentials > Install a certificate > CA certificate).
2. In MyFin on the laptop: Transactions > Import > **Pair phone**. Scan the QR code with the phone
   camera (opens the app in Chrome and pairs automatically), then Chrome menu > Install app.
   Or open `https://<name>.local:3443/share/` yourself and type the 6-digit code.
3. Paired phones are listed in the same dialog and can be removed there.

## Daily use
PhonePe/Files > Share > MyFin Share. The file is sent immediately if the laptop is reachable,
otherwise it waits on the phone (open the app on the same Wi-Fi to flush it).
On the laptop: Transactions > Import > "Received from your phone" > click the file.
Re-importing the same statement is safe (duplicates are detected); use the bin icon to clear files.
