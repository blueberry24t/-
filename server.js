
const express = require("express");
const OpenAI = require("openai");
const multer = require("multer");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI 연결
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// GitHub Pages 연결
app.use(cors({
  origin: "https://blueberry24t.github.io"
}));

app.use(express.json());

// 파일 업로드 설정
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 5
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png"
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("PDF, JPG, PNG 파일만 업로드할 수 있습니다."));
    }
  }
});

// 서버 상태 확인
app.get("/", (req, res) => {
  res.send("내신메이커 AI 서버가 정상 작동 중입니다!");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// AI 문제 생성
app.post("/api/generate", upload.array("files", 5), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: "OpenAI API 키가 등록되지 않았습니다."
      });
    }

    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        error: "학습 자료를 업로드해 주세요."
      });
    }

    const count = Number(req.body.count);
    const difficulty = Number(req.body.difficulty);
    const subject = req.body.subject || "일반 과목";

    if (!Number.isInteger(count) || count < 5 || count > 30 ||
        !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      return res.status(400).json({
        error: "문제 수 또는 난이도 설정이 올바르지 않습니다."
      });
    }

    let types;

    try {
      types = JSON.parse(req.body.types || "[]");
    } catch {
      return res.status(400).json({
        error: "문제 유형 설정을 확인해 주세요."
      });
    }

    // 현재 시험지 화면은 5지선다 채점을 지원
    if (!Array.isArray(types) ||
        !types.includes("객관식 5지선다")) {
      return res.status(400).json({
        error: "현재 버전에서는 5지선다형을 선택해 주세요."
      });
    }

    // 업로드 파일을 AI 입력으로 변환
    const content = [];

    for (const file of files) {
      const base64 = file.buffer.toString("base64");

      if (file.mimetype === "application/pdf") {
        content.push({
          type: "input_file",
          filename: "study-material.pdf",
          file_data: `data:application/pdf;base64,${base64}`,
          detail: "high"
        });
      } else {
        content.push({
          type: "input_image",
          image_url: `data:${file.mimetype};base64,${base64}`,
          detail: "high"
        });
      }
    }

    const prompt = `
너는 대한민국 고등학교 내신 시험 출제 전문가야.

업로드된 학습 자료의 내용을 정확하게 분석하고
자료에 근거한 객관식 5지선다형 문제를 만들어 줘.

[출제 조건]
과목: ${subject}
문제 수: ${count}
난이도: ${difficulty}/5

[출제 원칙]
1. 반드시 업로드 자료에 근거할 것.
2. 자료에 없는 내용을 정답으로 만들지 말 것.
3. 문제마다 선택지 5개를 만들 것.
4. 정답은 0부터 4까지의 숫자로 표시할 것.
5. 각 문제에 자세한 해설을 포함할 것.
6. 문제 간 중복을 최소화할 것.
7. 자료를 읽을 수 없다면 내용을 추측하지 말 것.

반드시 아래 JSON 형식으로만 응답해.

{
  "questions": [
    {
      "type": "객관식 5지선다",
      "text": "문제 내용",
      "opts": [
        "선택지 1",
        "선택지 2",
        "선택지 3",
        "선택지 4",
        "선택지 5"
      ],
      "answer": 0,
      "explain": "정답과 오답에 대한 해설"
    }
  ]
}

정확히 ${count}개의 문제를 만들어 줘.
`;

    content.push({
      type: "input_text",
      text: prompt
    });

    // OpenAI Responses API 호출
    const response = await openai.responses.create({
      model: "gpt-6.2-sol",
      input: [
        {
          role: "user",
          content: content
        }
      ]
    });

    const result = JSON.parse(response.output_text);

    if (!Array.isArray(result.questions) ||
        result.questions.length !== count) {
      throw new Error("AI가 올바른 문제 형식으로 응답하지 않았습니다.");
    }

    for (const q of result.questions) {
      if (
        typeof q.text !== "string" ||
        !Array.isArray(q.opts) ||
        q.opts.length !== 5 ||
        !Number.isInteger(q.answer) ||
        q.answer < 0 ||
        q.answer > 4 ||
        typeof q.explain !== "string"
      ) {
        throw new Error("생성된 문제의 형식이 올바르지 않습니다.");
      }
    }

    res.json(result);

  } catch (error) {
    console.error("AI 문제 생성 오류:", error.message);

    res.status(500).json({
      error: "문제 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    });
  }
});

// 파일 업로드 오류 처리
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: "파일 크기 또는 업로드 개수를 확인해 주세요."
    });
  }

  if (err) {
    return res.status(400).json({
      error: err.message
    });
  }

  next();
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`내신메이커 서버 실행 중: ${PORT}`);
});
