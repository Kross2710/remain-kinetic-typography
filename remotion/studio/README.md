# Remain Studio · bản thử nghiệm

Studio là workspace riêng; player và Remotion composition của bản demo cũ không đổi.

## Chạy local

Cần Node.js 22.12+ (hoặc Node.js 24 LTS), npm, FFmpeg trong `PATH` và một trình duyệt. Từ thư mục gốc:

```sh
cd remotion
npm ci
npx remotion browser ensure
npm run studio:build
npm run studio
```

Mở `http://127.0.0.1:4317`. Chọn nhạc, dán lời (mỗi câu một dòng) hoặc nhập `.lrc`/Enhanced LRC, rồi bấm **Áp dụng lời**. Bấm **Phát**, rồi dùng **Space**, **T** hoặc nút **Đóng dấu từ** theo nhạc. Studio tự chuyển chữ và chuyển dòng mà không tua; lần chấm chữ đầu đặt lại mốc đầu dòng theo nhịp thật. Khi chọn một dòng bằng tay ở mục canh lời, playhead lùi 0,3 giây để bạn nghe nhịp dẫn vào câu. Đổi tỉ lệ ở góc trên trước khi xuất.

- Xuất MP4 H.264, 30 fps ở 720×1280 hoặc 1280×720; dùng nhạc riêng hoặc âm thanh gốc của video nếu có.
- Timeline theo thời lượng file dài nhất. Video là lớp nền; nếu có file nhạc riêng, Studio dùng nhạc đó thay cho âm thanh gốc của video. Có thể xoá hết nội dung ô lời rồi áp dụng để xuất không có chữ.
- Trong **Thiết lập xuất**, chọn **Toàn bộ timeline** hoặc **Một đoạn**, rồi nhập mốc đầu/cuối theo giây hoặc lấy mốc từ playhead. Việc chọn đoạn chỉ ảnh hưởng file xuất, không xoá nội dung khỏi project.
- Không còn giới hạn 30 giây cho nhạc. Giới hạn bảo vệ host: timeline tối đa 2 giờ, file nhạc 25 MiB, file video 100 MiB. Video nên dùng MP4 (H.264) hoặc WebM mà trình duyệt đọc được.
- Preview và export dùng cùng một composition. Khi bấm **Xuất MP4**, file nhạc/video được gửi tới máy chạy Studio để render; preview không gửi file. Server mặc định chỉ bind loopback, chạy một job mỗi lần. Không expose endpoint render ra Internet: chưa có tài khoản, quota hay hàng đợi dùng chung.
- Chưa có project save/load, nhiều lớp video, waveform, tự căn lời hoặc render trực tiếp bên trong trình duyệt.

## Dev mode: không cần build lại khi sửa frontend

Từ `remotion/`, chạy `npm run studio:dev` thay cho `npm run studio:build` và `npm run studio`. Giao diện Vite, Fast Refresh và API xuất MP4 dùng chung cổng (mặc định `4317`). Sửa CSS/TSX thông thường sẽ cập nhật ngay; thay đổi cấu trúc hooks hoặc file entry vẫn có thể tải lại và làm mất trạng thái chưa lưu. Sửa `studio/server.mjs` thì khởi động lại dev server, không cần build. Chỉ dùng dev mode trên loopback hoặc LAN tin cậy vì nó phục vụ mã nguồn frontend.

## UI: Tailwind và shadcn/ui

- `studio/theme.css`: Tailwind v4 và các token màu của Studio. Không bật Preflight để tránh thay đổi control native và composition Remotion.
- `studio/components/ui/`: `Button`, `Input`, `Textarea` từ shadcn/ui (New York/Radix). Alias `@/` trỏ vào `studio/`. Timeline và dropdown vẫn dùng control native để giữ hành vi bàn phím.
- Từ `remotion/`, kiểm tra đường dẫn registry bằng `npx shadcn@4.23.1 info --json`. Khi cần component mới, xem trước thay đổi bằng `npx shadcn@4.23.1 add <tên-component> --dry-run`.

## Truy cập từ một máy khác cùng LAN

Để thử trên LAN tin cậy, thay `192.168.1.215` bằng IPv4 riêng của máy đang chạy Studio:

```sh
STUDIO_BIND=0.0.0.0 STUDIO_LAN_HOST=192.168.1.215 npm run studio
```

Mở `http://192.168.1.215:4317` trên máy kia. Studio chỉ chấp nhận địa chỉ đã cấu hình và máy khách trong cùng subnet; GitHub Pages không đổi. Không port-forward hay dùng chế độ này trên mạng không tin cậy: Studio chưa có xác thực hoặc HTTPS.

Nếu UFW trên host chặn kết nối, thêm rule giới hạn đúng subnet và địa chỉ đích (thay ví dụ bằng địa chỉ mạng của bạn):

```sh
sudo ufw allow from 192.168.1.0/24 to 192.168.1.215 port 4317 proto tcp
```

## Kiểm thử

```sh
npm run studio:check
# Chạy server như trên ở terminal khác; kiểm thử E2E cần ffmpeg và ffprobe trong PATH.
npm run studio:e2e
npm run studio:e2e:media
```
