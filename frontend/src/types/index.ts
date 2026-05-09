export interface User {
  id: number;
  username: string;
  role: 'student' | 'ar_staff' | 'admin';
  email?: string;
  name?: string;
  created_at?: string;
  last_active_at?: string | null;
}

export interface Attachment {
  id: number;
  original_filename: string;
  content_type?: string | null;
  file_size_bytes: number;
  download_url: string;
  view_url: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface ChatMessage {
  id: number;
  sender: 'user' | 'bot';
  content: string;
  created_at: string;
  confidence_score?: number | null;
  found_answer?: boolean | null;
  typing_effect?: boolean;
  attachments?: Attachment[];
}

export interface Chat {
  id: number;
  title: string;
  created_at: string;
  messages: ChatMessage[];
}

export interface Ticket {
  id: number;
  reference_code: string;
  conversation_id: number;
  student_id: number;
  status: 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
  created_at: string;
  resolved_at?: string | null;
  preview_text?: string | null;
  student_identifier?: string | null;
  false_generated?: boolean;
  exclude_from_ingestion?: boolean;
  recommended_officer_id?: number | null;
  recommended_officer_username?: string | null;
  recommendation_score?: number | null;
  recommendation_reason?: string | null;
  recommendation_created_at?: string | null;
  auto_assigned?: boolean;
  assignment_reviewed?: boolean;
}

export interface TicketMessage {
  id: number;
  ticket_id: number;
  sender_role: 'student' | 'ar_staff' | 'bot';
  sender_id?: number;
  sender_alias?: string;
  content: string;
  created_at: string;
  attachments?: Attachment[];
}

export interface DashboardMetrics {
  totalTickets: number;
  openTickets: number;
  awaitingAssignment: number;
  activeStaff: number;
  resolvedToday: number;
  inProgress: number;
  assignedTickets: number;
}

export interface ApiResponse<T = any> {
  data?: T;
  message?: string;
  error?: string;
}
