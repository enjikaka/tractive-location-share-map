export type TrackerHistoryResponse = TrackerHistory[][]

export interface TrackerHistory {
  time: number
  latlong: number[]
  alt: number
  speed?: number
  course?: number
  pos_uncertainty: number
  sensor_used: 'KNOWN_WIFI' | 'GPS'
}

export interface TrackableObject {
  _id: string;
  _version: string;
  leaderboard_opt_out: boolean;
  device_id: string;
  _type: string;
  details: Details;
  read_only: boolean;
  created_at: number;
  home_location: number[];
}

export interface Details {
  _id: string;
  _version: string;
  name: string;
  pet_type: string;
  breed_ids: string[];
  gender: string;
  birthday: number;
  height: number;
  length: any;
  weight: number;
  chip_id: any;
  neutered: boolean;
  personality: any[];
  lost_or_dead: any;
  lim: any;
  ribcage: any;
  weight_is_default: any;
  height_is_default: boolean;
  birthday_is_default: any;
  breed_is_default: any;
  instagram_username: any;
  profile_picture_id: string;
  cover_picture_id: any;
  characteristic_ids: any[];
  gallery_picture_ids: any[];
  activity_settings: ActivitySettings;
  _type: string;
  read_only: boolean;
}

export interface ActivitySettings {
  _id: string;
  _version: string;
  daily_goal: number;
  daily_distance_goal: number;
  daily_active_minutes_goal: number;
  activity_category_thresholds_override: any;
  daily_active_minutes_goal_is_default: boolean;
  _type: string;
}

export type MultipleTrackersResponse = SingleTracker[];

export interface SingleTracker {
  _id: string;
  _type: string;
  _version: string;
}

export interface TrackerResponse {
  _id: string;
  _version: string;
  hw_id: string;
  model_number: string;
  hw_edition: string;
  bluetooth_mac: any;
  geofence_sensitivity: string;
  read_only: boolean;
  demo: boolean;
  self_test_available: boolean;
  capabilities: string[];
  supported_geofence_types: string[];
  fw_version: string;
  battery_save_mode: boolean;
  state: string;
  state_reason: string;
  charging_state: string;
  battery_state: string;
  power_saving_zone_id: string;
  prioritized_zone_id: string;
  prioritized_zone_type: string;
  prioritized_zone_last_seen_at: number;
  prioritized_zone_entered_at: number;
  _type: string;
}

export interface TrackerLocationResponse {
  time: number;
  time_rcvd: number;
  pos_status: any;
  latlong: number[];
  speed: any;
  pos_uncertainty: number;
  _id: string;
  _type: string;
  _version: string;
  altitude: number;
  report_id: string;
  sensor_used: string;
  nearby_user_id: any;
  power_saving_zone_id: string;
  address: Address;
}

export interface Address {
  street: string;
  house_number: string;
  zip_code: string;
  city: string;
  country: string;
  full_address: string;
}

export interface TrackerHardwareResponse {
  time: number;
  battery_level: number;
  clip_mounted_state: any;
  _id: string;
  _type: string;
  _version: string;
  report_id: string;
  power_saving_zone_id: string;
  hw_status: any;
}
