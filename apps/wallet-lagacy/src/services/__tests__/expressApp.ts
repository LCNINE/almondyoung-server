import * as express from 'express'; // ← * as import
import * as multer from 'multer';

const app = express();
app.use(express.json());

// 파일 업로드를 위한 multer 설정
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB 제한
  },
});

app.post('/signup', (req: any, res: any) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: 'username and password are required' });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: 'password must be at least 8 characters' });
  }
  return res.status(201).json({ message: 'user created' });
});

app.get('/users/:userId', (req: any, res: any) => {
  const { userId } = req.params;
  if (userId === 'penek') {
    return res.status(200).json({
      userId: 'penek',
      username: 'hun',
      email: 'penekhun@gmail.com',
      friends: ['zagabi', 'json'],
    });
  }
  return res.status(404).json({ error: 'user not found' });
});

// 단일 파일 업로드 API
app.post('/upload/single', upload.single('file'), (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({ error: 'file is required' });
  }

  // 파일을 body에 직접 붙여서 처리
  req.body.file = {
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    buffer: req.file.buffer, // 메모리 저장소니까 buffer 존재
  };

  // 파일 타입 검증 (이미지만 허용)
  if (!req.body.file.mimeType.startsWith('image/')) {
    return res.status(400).json({ error: 'only image files are allowed' });
  }

  return res.status(201).json({
    message: 'file uploaded successfully',
    fileInfo: {
      originalName: req.body.file.originalName,
      mimeType: req.body.file.mimeType,
      size: req.body.file.size,
      uploadedAt: new Date().toISOString(),
    },
  });
});

// 다중 파일 업로드 API
app.post('/upload/multiple', upload.array('files', 3), (req: any, res: any) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'at least one file is required' });
  }

  // 타입 단언을 any로 변경하여 타입 에러 방지
  const files = req.files as any[];

  // 모든 파일이 이미지인지 검증
  const invalidFiles = files.filter(
    (file) => !file.mimetype.startsWith('image/'),
  );
  if (invalidFiles.length > 0) {
    return res.status(400).json({ error: 'only image files are allowed' });
  }

  const fileInfos = files.map((file) => ({
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  }));

  return res.status(201).json({
    message: 'files uploaded successfully',
    uploadedCount: files.length,
    files: fileInfos,
    uploadedAt: new Date().toISOString(),
  });
});

export default app;
