# Sổ Quỹ — Trình tạo mã QR VietQR

Web tĩnh 100%, không backend, deploy thẳng lên GitHub Pages.

## Cấu trúc dữ liệu — 3 file JSON tách riêng

| File | Vai trò | CRUD trên web? | Đồng bộ GitHub? |
|---|---|---|---|
| `data/vietqr-banks.json` | Danh sách ngân hàng gốc từ VietQR (id/code/bin/logo) — dùng để tra cứu & autofill, tương đương bảng m dùng VLOOKUP trong Excel | Không, chỉ đọc | Không cần — có nút **"Làm mới ngân hàng từ VietQR"** gọi thẳng `api.vietqr.io/v2/banks` |
| `data/my-accounts.json` | Danh sách tài khoản cá nhân, giữ nguyên tên cột như Excel gốc | Có — thêm/sửa/xoá dòng | Có — nút **Lưu lên GitHub** |
| `data/templates.json` | Mẫu nội dung chuyển khoản soạn sẵn | Có — thêm/xoá trong panel "Quản lý mẫu nội dung" | Có — nút **Lưu mẫu lên GitHub** riêng |

Tách `templates.json` khỏi `my-accounts.json` vì hai loại dữ liệu độc lập nhau — sửa mẫu nội dung không nên đụng tới danh sách tài khoản, và ngược lại, tránh conflict khi commit.

- **Danh sách tài khoản**: chọn ngân hàng từ dropdown (lấy từ `vietqr-banks.json`) để tự điền mã/BIN/logo, thêm/xoá dòng, bấm **Lưu lên GitHub** để commit lại `data/my-accounts.json`.
- **Tạo mã QR**: chọn tài khoản, nhập số tiền + nội dung (có thể chọn nhanh từ mẫu), ảnh QR lấy trực tiếp từ `img.vietqr.io` (không cần server/API key).

## 1. Đưa code lên GitHub

```bash
cd vietqr-generator
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

## 2. Bật GitHub Pages

Repo → **Settings → Pages** → Source: chọn branch `main`, thư mục `/ (root)` → Save.
Sau ~1 phút web sẽ chạy tại `https://<owner>.github.io/<repo>/`.

## 3. Tạo Personal Access Token để lưu CRUD lên GitHub

Token này cho phép web ghi đè file `data/banks.json` khi bạn bấm "Lưu lên GitHub".

1. Vào **github.com → Settings (tài khoản) → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. **Repository access**: chọn "Only select repositories" → chọn đúng repo này.
3. **Permissions → Repository permissions → Contents**: chọn **Read and write**.
4. Generate, copy token (dạng `github_pat_...`) — chỉ hiện 1 lần.
5. Mở web → bấm nút góc phải trên (chưa kết nối GitHub) → điền:
   - Owner: username/tổ chức GitHub của bạn
   - Repo: tên repo
   - Branch: `main`
   - File tài khoản: `data/my-accounts.json`
   - File template: `data/templates.json`
   - Token: dán token vừa tạo
   → **Lưu thông tin kết nối** → **Tải cả 2 file từ GitHub**.

Token chỉ được lưu trong `localStorage` của trình duyệt bạn đang dùng, không bị commit lên repo. Đổi máy khác thì phải nhập lại token.

⚠️ Vì token có quyền ghi vào repo, chỉ nhập nó trên máy cá nhân, không dùng trên máy chung / public. Nếu lộ token, vào lại trang tạo token trên GitHub để revoke ngay.

## 4. Cấu trúc dữ liệu

### `data/my-accounts.json` — đúng tên cột như file Excel gốc

```json
[
  {
    "data__id": 43,
    "list_name": "Tên gợi nhớ hiển thị trong dropdown",
    "data_num": "1031451081",
    "name_ac": "Chủ tài khoản",
    "data__name": "Vietcombank",
    "data__code": "VCB",
    "data__bin": "970436",
    "data__shortName": "Vietcombank",
    "data__logo": "https://cdn.vietqr.io/img/VCB.png",
    "data__short_name": "Vietcombank"
  }
]
```

`data__id` chính là `id` của ngân hàng trong `vietqr-banks.json` (kết quả VLOOKUP cũ của m) — trên web nó tự điền khi chọn ngân hàng từ dropdown, không cần gõ tay.

### `data/vietqr-banks.json` — dữ liệu gốc từ VietQR, chỉ đọc

```json
[
  { "id": 43, "name": "Ngân hàng TMCP Ngoại Thương Việt Nam", "code": "VCB", "bin": "970436", "shortName": "Vietcombank", "logo": "https://cdn.vietqr.io/img/VCB.png", "short_name": "Vietcombank" }
]
```

Snapshot 53 ngân hàng có hỗ trợ chuyển khoản/tra cứu tại thời điểm tạo file. Bấm **"Làm mới ngân hàng từ VietQR"** trên web để gọi lại `api.vietqr.io/v2/banks` và cập nhật danh sách mới nhất (không cần key, gọi thẳng client-side).

### `data/templates.json` — mẫu nội dung chuyển khoản

```json
[
  { "label": "Thanh toán đơn hàng", "content": "Thanh toan don hang" }
]
```

`bank_code`/`data__code` phải đúng mã ngân hàng VietQR hỗ trợ (VCB, TCB, VIB, MB, ICB, ACB, BIDV, ...) — xem danh sách đầy đủ tại `api.vietqr.io/v2/banks`.

## 5. Cơ chế tạo QR (không cần key)

```
https://img.vietqr.io/image/{bank_code}-{account_no}-{template}.png
  ?amount={so_tien}
  &addInfo={noi_dung}
  &accountName={ten_chu_tk}
```

`template`: `compact2` | `compact` | `qr_only` | `print` | `print2`.
Đây là ảnh tĩnh public của VietQR, gọi thẳng từ trình duyệt, không cần token/API key riêng.
