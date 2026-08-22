// ---------- Widget nổi (dạng bong bóng chat) ----------
// File TÁCH RIÊNG khỏi app.js — chỉ lo việc thu nhỏ / mở rộng cửa sổ ứng
// dụng, không đụng tới logic dữ liệu/GitHub. Mỗi lần tải lại trang (F5),
// cửa sổ luôn MỞ SẴN (không nhớ trạng thái ẩn/hiện) để tránh tình trạng
// mở app lên nhưng không thấy gì vì lần trước lỡ thu nhỏ.
(function () {
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var bubble = document.getElementById("appBubble");
    var panel = document.getElementById("appPanel");
    var btnMinimize = document.getElementById("btnMinimizeApp");
    if (!bubble || !panel || !btnMinimize) return;

    function openPanel() {
      panel.hidden = false;
      bubble.hidden = true;
    }
    function minimizePanel() {
      panel.hidden = true;
      bubble.hidden = false;
    }

    bubble.addEventListener("click", openPanel);
    btnMinimize.addEventListener("click", minimizePanel);

    // Luôn bắt đầu ở trạng thái mở khi tải trang.
    openPanel();
  });
})();
