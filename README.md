# QR Generator

App tạo mã QR chuyển khoản (VietQR), đọc dữ liệu tài khoản/mẫu từ Google Sheets. Đây là site tĩnh thuần HTML/CSS/JS — không cần bước build.

## Chạy thử local

```bash
npm run dev
```

Lệnh này dùng gói `serve` (qua `npx`, không cần cài) để mở site tại `http://localhost:3000`.

## Đưa lên GitHub Pages

Có 2 cách, chọn 1:

### Cách 1 — GitHub Actions (khuyên dùng, tự động mỗi lần push)

1. Tạo repo trên GitHub, push toàn bộ thư mục này lên nhánh `main`:
   ```bash
   git init
   git add .
   git commit -m "Init QR generator"
   git branch -M main
   git remote add origin <URL_repo_cua_ban>
   git push -u origin main
   ```
2. Vào repo trên GitHub → **Settings → Pages → Source** → chọn **GitHub Actions**.
3. Workflow tại `.github/workflows/deploy.yml` sẽ tự chạy và deploy mỗi khi bạn push lên `main`. Xem tiến trình ở tab **Actions**.
4. Sau khi chạy xong, trang sẽ có tại `https://<username>.github.io/<ten-repo>/`.

### Cách 2 — npm script `gh-pages` (deploy thủ công)

```bash
npm run deploy
```

Lệnh này push nội dung thư mục hiện tại lên nhánh `gh-pages`. Sau đó vào **Settings → Pages → Source** chọn nhánh `gh-pages` (thư mục `/ (root)`).

## Lưu ý

- File `index.html` có tham chiếu tới `main.png` (logo + favicon) nhưng file này **chưa có** trong project — cần thêm ảnh `main.png` vào thư mục gốc trước khi deploy, nếu không logo/icon sẽ bị vỡ.
- App gọi dữ liệu trực tiếp từ Google Sheets (`docs.google.com`) — Google Sheet phải để chế độ chia sẻ "Anyone with the link can view" thì mới đọc được từ GitHub Pages.
- Thẻ CSP trong `index.html` giới hạn `connect-src` chỉ tới `docs.google.com` và `img.vietqr.io` — nếu bạn đổi nguồn dữ liệu, nhớ cập nhật CSP tương ứng.
