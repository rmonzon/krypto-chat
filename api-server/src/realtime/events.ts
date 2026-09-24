import type { ConversationDto } from "../conversations/service.js";
import type { MessageDto } from "../messages/service.js";

/** Events the server pushes to clients over the WebSocket. */
export type ServerEvent =
  | { type: "ready"; user_id: string }
  | {
      type: "message.ack";
      client_msg_id: string;
      conversation_id: string;
      seq: number;
      created_at: Date;
    }
  | { type: "message.new"; message: MessageDto }
  | { type: "conversation.new"; conversation: ConversationDto }
  | {
      type: "receipt.update";
      conversation_id: string;
      user_id: string;
      delivered_up_to_seq: number;
      read_up_to_seq: number;
    }
  | { type: "error"; reason: string; client_msg_id?: string };
