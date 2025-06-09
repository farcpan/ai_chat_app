import React, { useState, useEffect, useRef } from 'react';
import { BedrockRuntimeClient, ConverseStreamCommand, type ContentBlock, type Message, ConversationRole } from '@aws-sdk/client-bedrock-runtime';

/**
 * Bedrock Settings
 */
const client = new BedrockRuntimeClient({
  credentials: {
    accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID,
    secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY,
  },
  region: import.meta.env.VITE_AWS_REGION,
});

const bedrockModelId = import.meta.env.VITE_AWS_BEDROCK_MODEL_ID ?? "";

type CustomMessage = {
  id: string;
  role: ConversationRole;
  content: string | { document: { name: string; format: string; bytes: string; displayName: string } } | { text: string; document: { name: string; format: string; bytes: string; displayName: string } };
};

/**
 * ファイル名をサニタイズする関数
 */
const sanitizeFileName = (fileName: string): string => {
  //const extension = fileName.toLowerCase().endsWith('.pdf') ? '.pdf' : '';
  const nameWithoutExtension = fileName.replace(/\.pdf$/i, '');
  
  let sanitized = nameWithoutExtension
    .replace(/[^A-Za-z0-9\s\-\(\)\[\]]/g, '-') // 不正な文字をハイフンに
    .replace(/\s+/g, ' ') // 連続する空白を単一の空白に
    .replace(/\s/g, '-') // 空白をハイフンに変換
    .replace(/-+/g, '-') // 連続するハイフンを単一のハイフンに
    .trim();
  
  if (!sanitized) {
    sanitized = 'document';
  }
  
  sanitized = sanitized.substring(0, 256);
  
  return sanitized;
};

/**
 * App
 */
export const App: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<CustomMessage[]>([]);

  const generateId = () => Math.random().toString(36).substr(2, 9);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      if (selectedFile.size > 4 * 1024 * 1024) {
        alert('File size exceeds 4MB limit. Please upload a smaller PDF.');
        return;
      }
      setFile(selectedFile);
      console.log(`Selected file: ${selectedFile.name}, Size: ${selectedFile.size} bytes`);
    } else {
      alert('Please select a valid PDF file.');
    }
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content: ContentBlock[] = [];

    // テキスト入力が空でPDFがある場合、デフォルトプロンプトを使用
    const defaultPrompt = file && !input.trim() ? 'Please summarize the content of this PDF.' : input.trim();
    if (defaultPrompt) {
      content.push({ text: defaultPrompt });
    }

    let pdfBase64 = '';
    let sanitizedFileName = '';
    let displayFileName = '';
    if (file) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        pdfBase64 = arrayBufferToBase64(arrayBuffer);
        sanitizedFileName = sanitizeFileName(file.name);
        displayFileName = `${sanitizedFileName}.pdf`;
        console.log(`Original file name: ${file.name}, Sanitized: ${sanitizedFileName}, Display: ${displayFileName}`);
        content.push({
          document: {
            name: sanitizedFileName,
            format: 'pdf',
            source: { bytes },
          },
        });
      } catch (error) {
        console.error('File processing error:', error);
        setMessages((prev) => [
          ...prev,
          {
            role: ConversationRole.ASSISTANT,
            content: `ERROR: Failed to process PDF file.`,
            id: generateId(),
          },
        ]);
        setFile(null);
        setIsLoading(false);
        return;
      }
    }

    if (content.length === 0) return;

    // ユーザーメッセージを作成（UI表示用）
    const userMessage: CustomMessage = {
      role: ConversationRole.USER,
      content: !file
        ? defaultPrompt // テキストのみ
        : input.trim()
          ? { text: defaultPrompt, document: { name: sanitizedFileName, format: 'pdf', bytes: pdfBase64, displayName: displayFileName } } // テキスト＋PDF
          : { document: { name: sanitizedFileName, format: 'pdf', bytes: pdfBase64, displayName: displayFileName } }, // PDFのみ
      id: generateId(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setFile(null);

    setIsLoading(true);
    try {
      const aiMessageId = generateId();
      setMessages((prev) => [...prev, { role: ConversationRole.ASSISTANT, content: '', id: aiMessageId }]);

      // メッセージ履歴をConverse API形式に変換
      const converseMessages: Message[] = messages.map((msg) => {
        if (typeof msg.content === 'string') {
          return { role: msg.role, content: [{ text: msg.content }] as ContentBlock[] };
        } else if ('text' in msg.content) {
          const sanitizedMsgFileName = sanitizeFileName(msg.content.document.name);
          return {
            role: msg.role,
            content: [
              { text: msg.content.text },
              {
                document: {
                  name: sanitizedMsgFileName,
                  format: msg.content.document.format,
                  source: { bytes: new Uint8Array(atob(msg.content.document.bytes).split('').map((c) => c.charCodeAt(0))) },
                },
              },
            ] as ContentBlock[],
          };
        } else {
          const sanitizedMsgFileName = sanitizeFileName(msg.content.document.name);
          return {
            role: msg.role,
            content: [
              { text: 'Please summarize the content of this PDF.' },
              {
                document: {
                  name: sanitizedMsgFileName,
                  format: msg.content.document.format,
                  source: { bytes: new Uint8Array(atob(msg.content.document.bytes).split('').map((c) => c.charCodeAt(0))) },
                },
              },
            ] as ContentBlock[],
          };
        }
      });

      // 現在のユーザーメッセージを追加
      converseMessages.push({ role: ConversationRole.USER, content });

      console.log('Converse messages:', JSON.stringify(converseMessages, null, 2));

      const command = new ConverseStreamCommand({
        modelId: bedrockModelId,
        messages: converseMessages,
        system: [{ text: 'You are a friendly assistant!' }],
        inferenceConfig: { maxTokens: 2048, temperature: 0.7 },
      });

      const response = await client.send(command);

      let streamedText = '';
      if (response.stream) {
        for await (const chunk of response.stream) {
          if (chunk.contentBlockDelta?.delta?.text) {
            streamedText += chunk.contentBlockDelta.delta.text;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMessageId ? { ...msg, content: streamedText } : msg
              )
            );
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: ConversationRole.ASSISTANT,
          content: `ERROR: ${error instanceof Error ? error.message : 'Failed to get stream data.'}`,
          id: generateId(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', minWidth: '600px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2>AI Chat App</h2>
      <div style={{ border: '1px solid #ccc', padding: '10px', height: '500px', overflowY: 'scroll' }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              margin: '10px 0',
              padding: '10px',
              backgroundColor: msg.role === ConversationRole.USER ? '#e6f3ff' : '#f9f9f9',
              borderRadius: '8px',
              textAlign: msg.role === ConversationRole.USER ? 'right' : 'left',
            }}
          >
            <strong>{msg.role === ConversationRole.USER ? 'YOU' : 'AI'}:</strong>{' '}
            {typeof msg.content === 'string'
              ? msg.content
              : 'text' in msg.content
              ? `${msg.content.text} (Uploaded PDF: ${msg.content.document.displayName})`
              : `Uploaded PDF: ${msg.content.document.displayName}`}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter a prompt (e.g., 'Summarize this PDF') or leave blank for default"
          style={{ width: '60%', padding: '10px', marginRight: '10px' }}
          disabled={isLoading}
        />
        <input
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          style={{ marginRight: '10px' }}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
};
