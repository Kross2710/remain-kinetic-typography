/* clock.js
 * Đồng hồ cung cấp thời gian cho vòng lặp sync. Hai chế độ:
 *   - 'audio'   : đọc thẳng audio.currentTime (NGUỒN CHÂN LÝ khi có nhạc).
 *   - 'virtual' : đếm giờ ảo bằng performance.now() — để "Xem thử" khi CHƯA có file nhạc.
 * Cùng một vòng lặp dùng cho cả hai chế độ.
 */
window.KT = window.KT || {};
(function (KT) {
  function Clock(audioEl) {
    this.audio = audioEl;
    this.mode = 'audio';
    this._t = 0;            // thời gian ảo (giây)
    this._last = 0;         // mốc performance.now() lần tick trước
    this._running = false;  // chỉ dùng cho virtual
  }

  Clock.prototype.getTime = function () {
    if (this.mode === 'audio') return this.audio.currentTime || 0;
    return this._t;
  };

  Clock.prototype.isRunning = function () {
    if (this.mode === 'audio') return !this.audio.paused && !this.audio.ended;
    return this._running;
  };

  // --- điều khiển chế độ virtual ---
  Clock.prototype.startVirtual = function (fromT) {
    this.mode = 'virtual';
    this._t = fromT || 0;
    this._last = performance.now();
    this._running = true;
  };
  Clock.prototype.resumeVirtual = function () {
    this._last = performance.now();
    this._running = true;
  };
  Clock.prototype.pauseVirtual = function () {
    this._running = false;
  };
  // Kết thúc hẳn phiên xem thử: về sentinel 'audio' + reset giờ,
  // để lần bấm "Xem thử" sau đi vào nhánh chạy-lại-từ-đầu (chứ không resume).
  Clock.prototype.endVirtual = function () {
    this._running = false;
    this.mode = 'audio';
    this._t = 0;
  };
  Clock.prototype.setVirtual = function (t) {
    this._t = t;
    this._last = performance.now();
  };
  // Gọi mỗi frame: cộng dồn thời gian trôi qua (chỉ khi virtual đang chạy).
  Clock.prototype.tickVirtual = function () {
    if (this.mode !== 'virtual' || !this._running) return;
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    // Tab ẩn / lag nặng -> rAF treo, delta phình to. BỎ QUA khoảng trống thay vì nhảy vọt:
    // re-anchor mốc thời gian, giờ ảo "đợi" người dùng quay lại (không mất lyrics).
    if (dt > 0.5) dt = 0;
    this._t += dt;
    this._last = now;
  };

  KT.Clock = Clock;
})(window.KT);
