# Phone share app (PWA)

Share a PhonePe statement from your Android phone straight into MyFin's import screen.

The phone always talks to the laptop's stable Bonjour name (e.g. `https://EL-LM-001.local:3443`), so
a changing router IP does not matter. Find yours with `scutil --get LocalHostName` (add `.local`).

## One-time laptop setup
1. `brew install mkcert && mkcert -install`
2. Add to `myfin-api/.env`:
   ```
   SHARE_HTTPS=true
   # optional: SHARE_HTTPS_PORT=3443, SHARE_INBOX_DIR=./share-inbox, SHARE_PUBLIC_URL=https://<name>.local:3443
   # optional: SHARE_TLS_CERT / SHARE_TLS_KEY to use your own certificate instead of the auto-managed one
   ```
   The API creates `certs/` itself with mkcert, covering the laptop's `.local` name and its current IPs, and
   renews it automatically when the IP changes (no restart needed; it happens when you open Pair phone).
3. Restart the API (allow port 3443 through the macOS firewall).

## One-time phone setup
1. Copy the mkcert root CA (`mkcert -CAROOT`, file `rootCA.pem`) to the phone and install it
   (Settings > Security > Encryption & credentials > Install a certificate > CA certificate).
2. In MyFin on the laptop: Transactions > Import > **Pair phone** (if the phone can't connect, tap "Use IP address instead" for a QR with the current IP; an installed app is tied to its address, so after an IP change scan again and reinstall).
    Scan the QR code with the phone
   camera (opens the app in Chrome and pairs automatically), then Chrome menu > Install app.
   Or open `https://<name>.local:3443/share/` yourself and type the 6-digit code.
3. Paired phones are listed in the same dialog and can be removed there.

## Daily use
PhonePe/Files > Share > MyFin Share. The file is sent immediately if the laptop is reachable,
otherwise it waits on the phone (open the app on the same Wi-Fi to flush it).
On the laptop: Transactions > Import > "Received from your phone" > click the file.
Re-importing the same statement is safe (duplicates are detected); use the bin icon to clear files.
