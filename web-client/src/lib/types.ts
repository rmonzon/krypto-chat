export type Profile = {
  id: string
  username: string
  display_name: string
}

export type Conversation = {
  id: string
  peer: Profile
  last_seq: number
  created_at: string
}
