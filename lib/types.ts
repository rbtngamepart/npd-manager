export type Light = "green" | "yellow" | "red";

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  department: string | null;
  approved: boolean;
  is_game_part: boolean;
  is_admin: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  start_date: string | null;
  pm_id: string | null;
  pm_status: Light | null;
  pm_memo: string | null;
  archived: boolean;
  /** 구글 캘린더 말머리 (006 업데이트 후) */
  calendar_tags?: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: string;
  project_id: string;
  sort_order: number;
  name: string;
  department: string | null;
  related_departments: string[];
  /** 부서별 역할 {"게임파트":"주관","운영팀":"의견 청취"} */
  dept_roles: Record<string, string>;
  description: string | null;
  plan_start: string | null;
  plan_end: string | null;
  actual_start: string | null;
  expected_end: string | null;
  actual_end: string | null;
  progress: number;
  pm_status: Light | null;
  issue: string | null;
  next_action: string | null;
  assignee: string | null;
  needs_check: boolean;
  skipped: boolean;
  /** 구글 캘린더 연동 (006 업데이트 후) */
  cal_linked?: boolean;
  cal_follow?: boolean;
  cal_missing?: boolean;
  updated_at: string;
  updated_by: string | null;
}

export type LogKind = "memo" | "issue" | "decision" | "change";

export interface StageLog {
  id: string;
  project_id: string;
  stage_id: string | null;
  stage_name: string | null;
  kind: LogKind;
  body: string;
  author_id: string | null;
  created_at: string;
}

export interface TemplateStage {
  name: string;
  department?: string | null;
  related_departments?: string[];
  dept_roles?: Record<string, string>;
  description?: string | null;
  start_week?: number | null;
  weeks?: number | null;
  skipped?: boolean;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  stages: TemplateStage[];
  created_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: "editor";
  added_at: string;
}

export interface Department {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Invite {
  email: string;
  name: string | null;
  department: string | null;
  is_game_part: boolean;
  is_admin: boolean;
  project_ids: string[];
  invited_by: string | null;
  created_at: string;
  used_at: string | null;
  user_id: string | null;
}

export interface RoleType {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface CalendarEvent {
  key: string;
  uid: string;
  source_ids: string[];
  tag: string;
  tag_norm: string;
  project_id: string | null;
  stage_id: string | null;
  stage_name: string;
  detail: string | null;
  title: string;
  start_date: string;
  end_date: string;
  start_at: string | null;
  all_day: boolean;
  done: boolean;
  organizer: string | null;
  attendees: string[];
  removed: boolean;
  last_seen_at: string;
}

export interface CalendarSourceInfo {
  id: string;
  owner_id: string;
  label: string | null;
  /** ics: 비공개 주소 / script: Apps Script (007 업데이트 전에는 없음) */
  kind?: "ics" | "script";
  enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  event_count: number;
  created_at: string;
}
