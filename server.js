const express = require('express');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
};

app.post('/api/ask', async (req, res) => {
  try {
    const { question, pages } = req.body;

    if (!question || !pages || !Array.isArray(pages)) {
      return res.status(400).json({ error: 'Missing question or pages array' });
    }

    const client = getOpenAIClient();
    if (!client) {
      return res.status(500).json({ error: 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable.' });
    }

    // Build document context with page numbers
    const documentText = pages
      .map((text, i) => `--- PAGE ${i + 1} ---\n${text}`)
      .join('\n\n');

    const systemPrompt = `You are a document analysis assistant. The user has uploaded a document and is asking questions about it.

You will receive the full text of the document organized by page number. When answering:
1. Answer the question accurately based ONLY on the document content.
2. Identify the exact source passage(s) you used to form your answer.
3. For each source, provide the exact quote from the document and the page number it appears on.

IMPORTANT: The "text" field in each source must be an EXACT substring copy-pasted from the document text. Do not paraphrase or summarize the source text. It must match character-for-character so it can be found in the document.

Respond in this exact JSON format:
{
  "answer": "Your natural language answer here",
  "sources": [
    {
      "text": "exact quote from the document that supports your answer",
      "page": 1
    }
  ]
}

If the document doesn't contain enough information to answer the question, say so in the answer and return an empty sources array.
Always respond with valid JSON only, no markdown formatting.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Document:\n${documentText}\n\nQuestion: ${question}` }
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const content = response.choices[0].message.content.trim();

    // Parse the JSON response
    let parsed;
    try {
      // Strip markdown code fences if present
      const cleaned = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { answer: content, sources: [] };
    }

    res.json(parsed);
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: 'Failed to get AI response. Please try again.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`docpilot server running on port ${PORT}`);
});
