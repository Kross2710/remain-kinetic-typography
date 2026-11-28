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
- Project lời cũ vẫn theo file dài nhất. Video là lớp nền; nếu có file nhạc riêng, Studio dùng nhạc đó thay cho âm thanh gốc của video.
- Trong **Thiết lập xuất**, chọn **Toàn bộ timeline** hoặc **Một đoạn**, rồi nhập mốc đầu/cuối theo giây hoặc lấy mốc từ playhead. Việc chọn đoạn chỉ ảnh hưởng file xuất, không xoá nội dung khỏi project.
- Giới hạn bảo vệ máy: timeline tối đa 2 giờ, nhạc 25 MiB, tổng file video nguồn 100 MiB. Bước chuẩn bị nguồn khi xuất project video còn giới hạn tổng tiền tố nguồn cần giải mã ở 2 giờ và video trung gian ở 512 MiB. Nếu vượt giới hạn, hãy dùng đoạn nguồn ngắn hơn. Video nên dùng MP4 (H.264) hoặc WebM mà trình duyệt đọc được.
- Preview và export dùng cùng một composition. Khi bấm **Xuất MP4**, file nhạc/video được gửi tới máy chạy Studio để render; preview không gửi file. Server mặc định chỉ bind loopback, chạy một job mỗi lần. Không expose endpoint render ra Internet: chưa có tài khoản, quota hay hàng đợi dùng chung.
- Inspector có 5 tab. Dùng **Media** để nạp tệp, **Lời** để nhập lời, rồi quay về **Canh từ**. Đổi tab không reset bản nháp hay playhead. Trên desktop, timeline nằm ngay dưới Preview; bấm cue để chọn dòng/tua đến mốc và xem dấu ✓ khi đã canh hết từ.
- Tab **Project** lưu/nạp JSON; file JSON không nhúng nguồn video hay nhạc. Phiên local tự lưu nguồn trong trình duyệt nếu còn dung lượng. Không có nhiều track video, clip chồng nhau, transition hay render trực tiếp trong trình duyệt.

## Dựng video không cần lời

1. Bấm **Project video mới**, rồi vào **Media → Thêm clip video**. Chọn một hoặc nhiều file; tổng nguồn video tối đa 100 MiB.
2. Kéo clip trên làn Video để đổi thứ tự. Kéo tay nắm ở hai đầu để trim hoặc nhập khung đầu/cuối của nguồn. Đặt đầu phát trong clip đã chọn, rồi bấm **Tách tại đầu phát**. Clip sau luôn dồn vào clip trước. **Hoàn tác** khôi phục cả thao tác.
3. Thêm một bản nhạc nền nếu cần. Khi thêm nhạc, Studio tắt tiếng clip theo mặc định. Chọn clip cần giữ tiếng gốc rồi bấm **Bật tiếng clip**. Clip cuối quyết định thời lượng xuất; lời và nhạc còn dư không bị xóa khỏi project.
4. Xuất MP4, hoặc lưu JSON để mở lại. Clip thiếu nguồn vẫn giữ các điểm cắt và chỉnh được; cần **Liên kết lại nguồn** hoặc xóa clip thiếu mới xuất được.

## Phối cảnh từng dòng

Chọn dòng → **Hiệu ứng → Căn phối cảnh dòng**. Preview tạm dừng; kéo dấu giữa để dời chữ, tay nắm xoay để xoay, hoặc kéo từng góc. Khung tự cắt bị từ chối. **Đặt lại phối cảnh** chỉ đặt lại dòng đang chọn. Đổi ngang/dọc giữ tọa độ và hiện nhắc kiểm tra lại.

**Gắn vào clip** chuyển dòng từ mốc bài hát sang mốc của cảnh chứa dòng. Đổi thứ tự đưa dòng đi cùng cảnh; trim chỉ ẩn phần ngoài đoạn giữ lại; split không phát lại hiệu ứng. **Đưa về lời theo nhạc** bỏ gắn nhưng giữ phối cảnh. Classic, Aurora và Whisper hỗ trợ cách căn này; Web Match không áp dụng phối cảnh hoặc gắn cảnh, không xóa thiết lập đã lưu.

## Preset chữ và đoạn nhạc

Trong **Hiệu ứng chữ**, chọn **Whisper**, **Classic** (kiểu cũ) hoặc **Aurora**. **Whisper** là mặc định cho project mẫu; project video mới dùng **Classic**. Project đã lưu giữ nguyên kiểu cũ. Whisper có nền trôi nhẹ, vignette và grain; dòng đang hát trôi nhẹ, tối đa hai dòng trước thu nhỏ và mờ dần. Chọn một dòng rồi bấm **Đánh dấu hook** để chữ của riêng dòng đó thấm vào theo từng ký tự khi dùng Whisper. Chỉnh font, cỡ, màu chữ, màu nhấn, thời lượng vào và độ trễ giữa các từ. Mặc định áp vào toàn project; chuyển sang **Dòng đang chọn** để tạo kiểu riêng, hoặc bấm **Dùng kiểu mặc định** để bỏ kiểu riêng. Chọn một từ trong panel canh lời trước khi bật nhấn từ.

**Hiện thanh Verse/Chorus trong video** mặc định tắt. Khi bật, tua tới đầu đoạn, chọn loại đoạn rồi thêm mốc tại playhead. Mỗi đoạn kéo dài tới mốc kế tiếp hoặc hết timeline. Tắt thanh không xóa mốc; project JSON lưu cả preset, kiểu riêng, nhấn từ và các mốc đoạn nhạc.

### Hiệu ứng dùng chung

Chọn **Classic**, **Aurora** hoặc **Whisper**, rồi bật từng mục trong **Hiệu ứng → Hiệu ứng dùng chung**:

- **Trồi lên và rõ dần:** cả dòng rõ dần, từng từ trượt lên qua khung che.
- **Karaoke:** chữ đổi từ màu chữ sang màu nhấn lần lượt theo từng ký tự, dựa trên mốc từ.
- **Hook thấm mực:** áp dụng cho dòng được đánh dấu hook (hoặc hook gốc *I will remain*); nó thay hiệu ứng vào chữ của dòng. Trong hook, từ *love* hiện đúng mốc hát.
- **Cuộn cột lời:** đưa câu đang hát tới 58% chiều cao khung; các câu cũ đi lên, nhỏ và mờ dần. Tùy chọn này chỉ đặt ở cấp project.

Ba hiệu ứng chữ có thể **Bật**, **Tắt** hoặc **Theo project** cho từng dòng mà không đổi preset của dòng đó. Các tùy chọn đi cùng project JSON và giữ nguyên khi chuyển preset. **Web Match** vẫn giữ bản gốc và không áp thêm các tùy chọn này.

### Web Match

Trong **Hiệu ứng → Toàn bộ project**, chọn **Web Match**. Preset dùng chính CSS, GSAP và luồng chữ của `index.html` trong một khung riêng; Whisper, Aurora và Classic không đổi. Dùng cùng video, nhạc và timing lời để so với bản web. Khung ngang dùng bố cục desktop; khung dọc dùng bố cục mobile. Font được đóng gói trong Studio, không cần gọi Google Fonts khi xuất.

Web Match dùng cả cột lời để cuộn, nên tạm bỏ qua kiểu riêng từng dòng (không xoá chúng). Các dòng có cụm *I will remain* dùng hook giống bản web; với lời khác, dùng **Đánh dấu hook** nếu muốn kiểu chữ nghiêng và vào từng ký tự. Bật **Hiện thanh Verse/Chorus trong video** nếu muốn thêm thanh tiến độ và nhãn đoạn như trên web. Nếu chưa đặt mốc đoạn, preset dùng các mốc gốc của bản web.

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

## Xuất bằng iGPU (tùy chọn)

Trong mục "Thiết lập xuất" có checkbox "Vẽ khung hình bằng iGPU". Mặc định **tắt**. Khi bật, upload gửi thêm field `gpu=1`, server truyền xuống render worker và worker đặt `chromiumOptions: {gl: 'vulkan'}` cho Remotion.

- Chỉ bật được phần **vẽ khung hình**. Remotion 4.0.484 không có bộ mã hoá VAAPI (hỗ trợ chỉ VideoToolbox trên macOS và NVENC trên NVIDIA), nên trên Intel N100 phần mã hoá vẫn là `libx264`.
- Đo trên N100, 90 khung 1280x720, có video nền thật: 3.84 fps -> 4.59 fps (+19%), PSNR 46.8 dB so với bản CPU. Clip chỉ có chữ, không video nền: 9.36 -> 9.61 fps, PSNR 53.4 dB.
- `gl: 'angle-egl'` cho ra file giống hệt từng byte nên không dùng.
- Pipeline xuất CLI (`export/`) có cờ riêng: `npm run both:gpu` / `npm run fast:gpu` (xem `export/README.md`).

## Timeline

Thước thời gian và ba làn Video, Nhạc, Lời cuộn ngang cùng nhau. Bấm hoặc kéo trên thước để tua theo khung hình; bấm nền một làn để tua, hoặc bấm đoạn lời để chọn dòng canh từ. Kéo thân đoạn lời để dời mốc dòng cùng các từ; kéo mép phải để sửa ranh giới với dòng tiếp theo (không có mốc kết thúc riêng). Chọn dòng, đặt playhead trước từ cần tách rồi bấm **Tách tại từ kế tiếp**. **Bắt dính mốc** mặc định tắt; bật để hút về mốc dòng gần đó, lưới giây và khung hình. Mỗi lần kéo tạo một bước Hoàn tác; thao tác vượt qua mốc từ/dòng khác bị từ chối.

Dùng Tab đến thanh vị trí rồi dùng phím mũi tên để tua bằng bàn phím. Khi khung timeline có focus, dùng Home/End để tới đoạn lời đầu/cuối, kể cả khi không có đoạn nào trong vùng nhìn. Trên một đoạn lời, dùng ←/→ để chuyển đoạn; Enter chọn và tua đến đoạn đó; Shift+←/→ dời dòng một khung hình; Alt+Shift+←/→ sửa ranh giới phải một khung hình. Ctrl/⌘ + cuộn phóng quanh con trỏ, còn **Vừa khung** đưa timeline về đầu và thu vừa khung nếu giới hạn zoom cho phép.

## Kiểm thử

```sh
npm run studio:check
npm run studio:e2e:timeline
npm run studio:e2e:video        # Studio riêng: dựng ba nguồn, lưu/mở, đo MP4 và âm thanh
npm run studio:e2e:perspective  # Studio riêng: căn chữ và đối chiếu preview với MP4 tại điểm cắt
node studio/test/video-source-parity-live.mjs # kiểm tra cắt nguồn 24 fps khớp preview và MP4
# Chạy server như trên ở terminal khác; kiểm thử E2E cần ffmpeg và ffprobe trong PATH.
npm run studio:e2e
npm run studio:e2e:workspace
npm run studio:e2e:media
npm run studio:gpu   # render thật 2 lần (CPU và iGPU) rồi so khung hình
node studio/test/whisper-live.mjs   # Studio riêng: so preview và MP4 trên clip Remain cố định
node studio/test/shared-motion-live.mjs # phối hiệu ứng, lưu/nạp và xuất MP4
node studio/test/web-match-live.mjs # so index.html, Studio và MP4 cùng khung hình
```

Khi sửa mã hoặc CSS của public player, chạy `node studio/update-web-match-assets.mjs` từ `remotion/` để cập nhật snapshot Web Match. `studio:check` kiểm tra các byte trong snapshot còn khớp với mã nguồn.
