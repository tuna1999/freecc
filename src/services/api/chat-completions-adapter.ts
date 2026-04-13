export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  source?: { type: string; media_type: string; data: string }
  [key: string]: unknown
}

interface AnthropicMessage {
  role: string
  content: string | AnthropicContentBlock[]
}

interface AnthropicTool {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Array<{ type: string; [key: string]: unknown }> }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

function translateTools(tools: AnthropicTool[]): Array<Record<string, unknown>> {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }))
}

function translateMessages(anthropicMessages: AnthropicMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  for (const msg of anthropicMessages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
      continue
    }

    if (!Array.isArray(msg.content)) continue

    if (msg.role === 'user') {
      const toolResults: OpenAIMessage[] = []
      const textParts: Array<{ type: string; [key: string]: unknown }> = []

      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const callId = block.tool_use_id || 'unknown'
          let outputText = ''
          if (typeof block.content === 'string') {
            outputText = block.content
          } else if (Array.isArray(block.content)) {
            outputText = block.content
              .map(c => {
                if (c.type === 'text') return c.text
                if (c.type === 'image') return '[Image data attached]'
                return ''
              })
              .join('\n')
          }
          toolResults.push({ role: 'tool', tool_call_id: callId, content: outputText })
        } else if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push({ type: 'text', text: block.text })
        } else if (
          block.type === 'image' &&
          typeof block.source === 'object' &&
          block.source !== null &&
          block.source.type === 'base64'
        ) {
          textParts.push({
            type: 'image_url',
            image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
          })
        }
      }

      // Tool results must come before any text in that turn
      for (const tr of toolResults) {
        result.push(tr)
      }

      if (textParts.length > 0) {
        if (textParts.length === 1 && textParts[0].type === 'text') {
          result.push({ role: 'user', content: textParts[0].text as string })
        } else {
          result.push({ role: 'user', content: textParts })
        }
      }
    } else if (msg.role === 'assistant') {
      let textContent = ''
      const toolCalls: OpenAIToolCall[] = []

      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textContent += block.text
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id || `call_${Date.now()}`,
            type: 'function',
            function: {
              name: block.name || '',
              arguments: JSON.stringify(block.input || {}),
            },
          })
        }
      }

      const assistantMsg: { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] } = {
        role: 'assistant',
        content: textContent || null,
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls
      }
      result.push(assistantMsg)
    }
  }

  return result
}

interface ToolCallState {
  id: string
  name: string
  args: string
  blockIndex: number
}

async function translateChatCompletionsStreamToAnthropic(
  response: Response,
  model: string,
): Promise<Response> {
  const messageId = `msg_or_${Date.now()}`

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      controller.enqueue(
        encoder.encode(
          formatSSE(
            'message_start',
            JSON.stringify({
              type: 'message_start',
              message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }),
          ),
        ),
      )

      controller.enqueue(
        encoder.encode(formatSSE('ping', JSON.stringify({ type: 'ping' }))),
      )

      let contentBlockIndex = 0
      let textBlockOpen = false
      let hadToolCalls = false
      let inputTokens = 0
      let outputTokens = 0
      const toolCallMap = new Map<number, ToolCallState>()

      try {
        const reader = response.body?.getReader()
        if (!reader) {
          controller.enqueue(
            encoder.encode(
              formatSSE(
                'content_block_start',
                JSON.stringify({
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: { type: 'text', text: '' },
                }),
              ),
            ),
          )
          controller.enqueue(
            encoder.encode(
              formatSSE(
                'content_block_delta',
                JSON.stringify({
                  type: 'content_block_delta',
                  index: contentBlockIndex,
                  delta: { type: 'text_delta', text: 'Error: No response body' },
                }),
              ),
            ),
          )
          controller.enqueue(
            encoder.encode(
              formatSSE(
                'content_block_stop',
                JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex }),
              ),
            ),
          )
          finishStream(controller, encoder, inputTokens, outputTokens, false)
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const dataStr = trimmed.slice(6)
            if (dataStr === '[DONE]') continue

            let chunk: Record<string, unknown>
            try {
              chunk = JSON.parse(dataStr)
            } catch {
              continue
            }

            const choices = chunk.choices as Array<{
              delta: {
                content?: string | null
                tool_calls?: Array<{
                  index: number
                  id?: string
                  type?: string
                  function?: { name?: string; arguments?: string }
                }>
              }
              finish_reason?: string | null
            }> | undefined

            if (!choices || choices.length === 0) {
              // Check for top-level usage
              const usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
              if (usage) {
                inputTokens = usage.prompt_tokens ?? inputTokens
                outputTokens = usage.completion_tokens ?? outputTokens
              }
              continue
            }

            const choice = choices[0]
            const delta = choice.delta

            // Handle text content
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              if (!textBlockOpen) {
                controller.enqueue(
                  encoder.encode(
                    formatSSE(
                      'content_block_start',
                      JSON.stringify({
                        type: 'content_block_start',
                        index: contentBlockIndex,
                        content_block: { type: 'text', text: '' },
                      }),
                    ),
                  ),
                )
                textBlockOpen = true
              }
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_delta',
                    JSON.stringify({
                      type: 'content_block_delta',
                      index: contentBlockIndex,
                      delta: { type: 'text_delta', text: delta.content },
                    }),
                  ),
                ),
              )
            }

            // Handle tool calls
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              // Close text block if open before starting tool calls
              if (textBlockOpen) {
                controller.enqueue(
                  encoder.encode(
                    formatSSE(
                      'content_block_stop',
                      JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex }),
                    ),
                  ),
                )
                contentBlockIndex++
                textBlockOpen = false
              }

              for (const tc of delta.tool_calls) {
                const idx = tc.index

                if (!toolCallMap.has(idx)) {
                  // First chunk for this tool call — emit content_block_start
                  const toolId = tc.id || `call_${Date.now()}_${idx}`
                  const toolName = tc.function?.name || ''
                  const blockIdx = contentBlockIndex++
                  toolCallMap.set(idx, { id: toolId, name: toolName, args: '', blockIndex: blockIdx })
                  hadToolCalls = true

                  controller.enqueue(
                    encoder.encode(
                      formatSSE(
                        'content_block_start',
                        JSON.stringify({
                          type: 'content_block_start',
                          index: blockIdx,
                          content_block: {
                            type: 'tool_use',
                            id: toolId,
                            name: toolName,
                            input: {},
                          },
                        }),
                      ),
                    ),
                  )
                }

                const state = toolCallMap.get(idx)!

                // Update name if provided in a later chunk
                if (tc.function?.name && !state.name) {
                  state.name = tc.function.name
                }

                // Stream argument delta
                if (tc.function?.arguments) {
                  state.args += tc.function.arguments
                  controller.enqueue(
                    encoder.encode(
                      formatSSE(
                        'content_block_delta',
                        JSON.stringify({
                          type: 'content_block_delta',
                          index: state.blockIndex,
                          delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
                        }),
                      ),
                    ),
                  )
                }
              }
            }

            // Extract usage from finish_reason chunk
            const usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
            if (usage) {
              inputTokens = usage.prompt_tokens ?? inputTokens
              outputTokens = usage.completion_tokens ?? outputTokens
            }
          }
        }
      } catch (err) {
        if (!textBlockOpen) {
          controller.enqueue(
            encoder.encode(
              formatSSE(
                'content_block_start',
                JSON.stringify({
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: { type: 'text', text: '' },
                }),
              ),
            ),
          )
          textBlockOpen = true
        }
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_delta',
              JSON.stringify({
                type: 'content_block_delta',
                index: contentBlockIndex,
                delta: { type: 'text_delta', text: `\n\n[Error: ${String(err)}]` },
              }),
            ),
          ),
        )
      }

      // Close text block if still open
      if (textBlockOpen) {
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_stop',
              JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex }),
            ),
          ),
        )
      }

      // Close all tool call blocks in blockIndex order
      const sortedToolCalls = Array.from(toolCallMap.values()).sort(
        (a, b) => a.blockIndex - b.blockIndex,
      )
      for (const state of sortedToolCalls) {
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_stop',
              JSON.stringify({ type: 'content_block_stop', index: state.blockIndex }),
            ),
          ),
        )
      }

      finishStream(controller, encoder, inputTokens, outputTokens, hadToolCalls)
    },
  })

  function finishStream(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    inputTokens: number,
    outputTokens: number,
    hadToolCalls: boolean,
  ) {
    const stopReason = hadToolCalls ? 'tool_use' : 'end_turn'
    controller.enqueue(
      encoder.encode(
        formatSSE(
          'message_delta',
          JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          }),
        ),
      ),
    )
    controller.enqueue(
      encoder.encode(
        formatSSE(
          'message_stop',
          JSON.stringify({
            type: 'message_stop',
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          }),
        ),
      ),
    )
    controller.close()
  }

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-request-id': messageId,
    },
  })
}

export function createChatCompletionsFetch(
  apiKey: string,
  baseUrl: string,
  extraHeaders: Record<string, string> = {
    'HTTP-Referer': 'https://github.com/anthropics/claude-code',
    'X-Title': 'Claude Code',
  },
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const normalizedBase = baseUrl.replace(/\/+$/, '')

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)

    if (!url.includes('/v1/messages')) {
      return globalThis.fetch(input, init)
    }

    let anthropicBody: Record<string, unknown>
    try {
      const bodyText =
        init?.body instanceof ReadableStream
          ? await new Response(init.body).text()
          : typeof init?.body === 'string'
            ? init.body
            : '{}'
      anthropicBody = JSON.parse(bodyText)
    } catch {
      anthropicBody = {}
    }

    const anthropicMessages = (anthropicBody.messages || []) as AnthropicMessage[]
    const systemPrompt = anthropicBody.system as
      | string
      | Array<{ type: string; text?: string }>
      | undefined
    const anthropicTools = (anthropicBody.tools || []) as AnthropicTool[]
    const model = (anthropicBody.model as string) || 'openai/gpt-4o'

    const oaiMessages: OpenAIMessage[] = []

    if (systemPrompt) {
      const systemText =
        typeof systemPrompt === 'string'
          ? systemPrompt
          : Array.isArray(systemPrompt)
            ? systemPrompt
                .filter(b => b.type === 'text' && typeof b.text === 'string')
                .map(b => b.text!)
                .join('\n')
            : ''
      if (systemText) {
        oaiMessages.push({ role: 'system', content: systemText })
      }
    }

    oaiMessages.push(...translateMessages(anthropicMessages))

    const oaiBody: Record<string, unknown> = {
      model,
      messages: oaiMessages,
      stream: true,
      stream_options: { include_usage: true },
    }

    if (anthropicTools.length > 0) {
      oaiBody.tools = translateTools(anthropicTools)
      oaiBody.tool_choice = 'auto'
    }

    if (anthropicBody.max_tokens) {
      oaiBody.max_tokens = anthropicBody.max_tokens
    }

    const endpoint = `${normalizedBase}/chat/completions`
    const apiResponse = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(oaiBody),
    })

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text()
      const errorBody = {
        type: 'error',
        error: {
          type: 'api_error',
          message: `OpenRouter API error (${apiResponse.status}): ${errorText}`,
        },
      }
      return new Response(JSON.stringify(errorBody), {
        status: apiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return translateChatCompletionsStreamToAnthropic(apiResponse, model)
  }
}
