import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg'); // capture trung gian (nhanh hơn png)
Config.setOverwriteOutput(true);
// Ép codec mặc định = H.264 -> nút Render trong Studio KHÔNG rơi vào AV1 (AV1/libaom rất chậm,
// dễ hết RAM khi 1080p). Muốn nhanh hơn (Media Engine M-series) thì render kèm:
//   --codec=h264 --hardware-acceleration=if-possible
Config.setCodec('h264');
