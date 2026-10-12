// Trusted local demo adapter. No tools are enabled; all inference stays local by default.
module.exports = {
  async run(input) {
    const endpoint = process.env.AGENTSPEC_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/v1/chat/completions';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: process.env.AGENTSPEC_MODEL || 'llama3.2:3b',
        messages: [
          { role: 'system', content: 'Follow the requested answer format exactly. Be concise. Do not add explanations when the user requests only a word or JSON.' },
          { role: 'user', content: input },
        ],
        temperature: 0,
        max_tokens: 256,
      }),
    });
    if (!response.ok) throw new Error(`Local model HTTP ${response.status}`);
    const result = await response.json();
    const text = result.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('Local model response has no text content');
    return { text, tokens: result.usage?.total_tokens, toolsCalled: [] };
  },
};
