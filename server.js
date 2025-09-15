import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
});
app.use(limiter);

// Helper: call OpenRouter DeepSeek with optimized parameters
async function callDeepSeek(prompt, maxTokens = 1000) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7, // Slightly lower for more focused responses
      top_p: 0.9,
      stream: false
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Summarize endpoint
app.post("/api/summarize", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "No content provided" });

    // Limit content length for faster processing
    const truncatedContent = content.length > 3000 ? content.substring(0, 3000) + "..." : content;

    const summary = await callDeepSeek(
      `Summarize the following text concisely for a student (max 200 words):\n\n${truncatedContent}`,
      500 // Lower token limit for summaries
    );

    res.json({ summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to summarize" });
  }
});

// FASTER Quiz endpoint - Generate directly from content, not summary
app.post("/api/generateQuiz", async (req, res) => {
  console.log("Quiz request received"); // For debugging
  try {
    const { summary, content } = req.body;
    
    // Use original content if available, fallback to summary
    const sourceText = content || summary;
    if (!sourceText) return res.status(400).json({ error: "No content or summary provided" });

    // Truncate for faster processing
    const truncatedText = sourceText.length > 2000 ? sourceText.substring(0, 2000) + "..." : sourceText;

    const quiz = await callDeepSeek(
      `Create 3 quick multiple-choice questions from this text. Return ONLY valid JSON array:
[{"question":"Q1?","options":["A","B","C","D"],"correctIndex":0,"hint":"Short hint","explanation":"Brief explanation"}]

Text: ${truncatedText}`,
      800 // Lower token limit for faster generation
    );

    console.log("Quiz generated, parsing...");

    // Faster JSON extraction
    let cleaned = quiz.trim();
    
    // Remove code fences if present
    if (cleaned.includes('```')) {
      cleaned = cleaned.replace(/```json\s*|\s*```/g, '');
    }
    
    // Find JSON array
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']') + 1;
    
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      cleaned = cleaned.substring(arrayStart, arrayEnd);
    }

    let quizData;
    try {
      quizData = JSON.parse(cleaned);
      
      // Quick validation and cleanup
      if (!Array.isArray(quizData)) {
        throw new Error("Not an array");
      }
      
      // Filter valid questions quickly
      quizData = quizData.filter(q => 
        q.question && 
        Array.isArray(q.options) && 
        q.options.length >= 2 &&
        typeof q.correctIndex === 'number'
      ).slice(0, 5); // Limit to 5 questions max
      
      if (quizData.length === 0) {
        throw new Error("No valid questions");
      }
      
    } catch (e) {
      console.error("JSON parsing failed:", e.message);
      return res.status(500).json({ 
        error: "Failed to parse quiz response",
        details: e.message
      });
    }

    console.log(`Returning ${quizData.length} questions`);
    res.json({ questions: quizData });
    
  } catch (err) {
    console.error("Quiz generation error:", err);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
});

app.listen(3000, () => {
  console.log("AI Study Tutor running on http://localhost:3000");
});