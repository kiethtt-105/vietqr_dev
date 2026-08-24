# Thư mục ảnh QR dự phòng (qr-fallback/)

Dùng khi `img.vietqr.io` (API tạo ảnh QR động) bị nghẽn/gián đoạn.
Khi ảnh QR chính tải lỗi, app sẽ tự động thử tải ảnh trong thư mục
này thay thế — **không cần sửa code**, chỉ cần upload đúng tên file.

## Cách đặt tên file

```
<Mã ngân hàng>-<Số tài khoản>.png
```

- **Mã ngân hàng**: lấy từ cột "Ngân hàng" trong Cài đặt → Tài khoản
  (ví dụ Vietcombank → `VCB`, Techcombank → `TCB`, MBBank → `MB`...).
  Đây là mã ngắn (BIN/short code) VietQR đang dùng, không phải tên đầy đủ.
- **Số tài khoản**: đúng số đã lưu ở cột "Số tài khoản" (giữ nguyên,
  không thêm khoảng trắng/ký tự lạ).
- Ví dụ tài khoản Vietcombank số `1031451081`:
  ```
  qr-fallback/VCB-1031451081.png
  ```

## Cách tạo ảnh

1. Lúc `img.vietqr.io` còn hoạt động bình thường, tạo QR như bình thường
   trong app (khuyên dùng **không nhập số tiền/nội dung**, hoặc dùng
   template "Qr_only", để ảnh dùng lâu dài mà không bị sai lệch số tiền).
2. Bấm "Tải ảnh QR" để lưu ảnh PNG về máy.
3. Đổi tên file đúng theo quy tắc ở trên rồi đẩy (upload/commit) vào
   thư mục `qr-fallback/` này trên GitHub.

## Lưu ý quan trọng

Ảnh dự phòng là **ảnh tĩnh** — nếu bạn tạo nó không kèm số tiền/nội
dung thì khi dùng thay thế, mã QR sẽ **không tự điền số tiền/nội dung**
bạn vừa nhập trên form (người quét sẽ phải tự nhập tay). Ứng dụng sẽ
báo rõ bằng thông báo màu vàng khi đang phải dùng ảnh dự phòng, để
bạn biết mà nhắc người chuyển khoản nhập tay số tiền nếu cần.

Chưa có ảnh cho một tài khoản nào đó thì không sao — app vẫn báo lỗi
tải ảnh như trước, không ảnh hưởng gì thêm.
