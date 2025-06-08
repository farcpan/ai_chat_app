import React, { useState, useEffect, useRef } from 'react';
import { generateText, streamText } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

/**
 * Bedrock Model ID
 */
const bedrockModelId = import.meta.env.VITE_AWS_BEDROCK_MODEL_ID ?? "";

/**
 * Bedrock Settings
 */
const bedrock = createAmazonBedrock({
  accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID,
  secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY,
  region: import.meta.env.VITE_AWS_REGION,
});

/**
 * App
 */
export const App: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /**
   * role: "user" or "assistant"
   * content: text (prompt or AI's output)
   * id: id for each content to identify each content
   */
  const [messages, setMessages] = useState<{ role: string; content: string; id: string }[]>([]);

  // id generator
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // scrolling when message is added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // adding user prompt to message list
    const userMessage = {
      role: 'user',
      content: input,
      id: generateId(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput(''); // clearing user input form

    setIsLoading(true);
    try {
      // AI message initilization
      const aiMessageId = generateId();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', id: aiMessageId },
      ]);

      // streaming the AI output
      const result = streamText({
        model: bedrock(bedrockModelId),
        prompt: input,
        system: 'You are a friendly assistant!',
      });

      // streaming data
      let streamedText = '';
      for await (const chunk of result.textStream) {
        streamedText += chunk;
        // AIメッセージのみを更新
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMessageId
              ? { ...msg, content: streamedText }
              : msg
          )
        );
      }
    } catch (error) {
      console.error('Streaming error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `ERROR: ${error instanceof Error ? error.message : 'Failed to get stream data.'}`,
          id: generateId(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', minWidth: "600px", maxWidth: '1200px', margin: '0 auto' }}>
      <h2>AI Chat App</h2>
      <div style={{ border: '1px solid #ccc', padding: '10px', height: '500px', overflowY: 'scroll' }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              margin: '10px 0',
              padding: '10px',
              backgroundColor: msg.role === 'user' ? '#e6f3ff' : '#f9f9f9',
              borderRadius: '8px',
              textAlign: msg.role === 'user' ? 'right' : 'left',
            }}
          >
            <strong>{msg.role === 'user' ? 'YOU' : 'AI'}:</strong> {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message..."
          style={{ width: '80%', padding: '10px', marginRight: '10px' }}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
};
