import type {
  MultipleTrackersResponse,
  TrackableObject,
  TrackerHardwareResponse,
  TrackerHistoryResponse,
  TrackerLocationResponse,
  TrackerResponse,
} from "./tractive.types";

export class Tractive {
  #clientId = "6536c228870a3c8857d452e8";
  #email: string;
  #password: string;
  #accountDetails: { token: string; uid: string } | null;
  #authentication: Promise<void> | null = null;
  #API_BASE_URL = "https://graph.tractive.com/4";

  constructor(email: string, password: string) {
    this.#email = email;
    this.#password = password;
    this.#accountDetails = null;
  }

  login(): Promise<void> {
    this.#authentication = this.authenticate();
    return this.#authentication;
  }

  async #authorizedFetch(path: string) {
    if (!path) {
      throw new Error("Path is required");
    }

    await this.#authentication;

    if (!this.isAuthenticated()) {
      throw new Error("Not authenticated");
    }

    const headers = new Headers();

    headers.set("X-Tractive-Client", this.#clientId);
    headers.set("Authorization", `Bearer ${this.#accountDetails!.token}`);
    headers.set("Content-Type", "application/json");

    const url = new URL(this.#API_BASE_URL + path);

    const response = await fetch(url.toString(), {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
    }

    return response.json();
  }

  isAuthenticated() {
    if (this.#accountDetails?.token) return true;
    return false;
  }

  async authenticate() {
    const url = new URL(this.#API_BASE_URL + "/auth/token");

    url.searchParams.set("grant_type", "tractive");
    url.searchParams.set("platform_email", this.#email);
    url.searchParams.set("platform_token", this.#password);

    const request = new Request(url.toString(), {
      method: "POST",
      headers: {
        "X-Tractive-Client": this.#clientId,
        "Content-Type": "application/json",
      },
    });

    const response = await fetch(request);
    const data = await response.json();
    this.#accountDetails = { token: data.access_token, uid: data.user_id };
  }

  async getTrackableObjects(): Promise<MultipleTrackersResponse> {
    await this.#authentication;
    return this.#authorizedFetch(
      `/user/${this.#accountDetails!.uid}/trackable_objects`,
    );
  }

  async getTrackableObject(
    trackableObjectId: string,
  ): Promise<TrackableObject> {
    await this.#authentication;
    return this.#authorizedFetch(`/trackable_object/${trackableObjectId}`);
  }

  async getAllTrackers(): Promise<MultipleTrackersResponse> {
    await this.#authentication;
    return this.#authorizedFetch(`/user/${this.#accountDetails!.uid}/trackers`);
  }

  getTracker(trackerId: string): Promise<TrackerResponse> {
    return this.#authorizedFetch(`/tracker/${trackerId}`);
  }

  async getTrackerLocation(
    trackerId: string,
  ): Promise<TrackerLocationResponse> {
    const positionReport = await this.#authorizedFetch(
      `/device_pos_report/${trackerId}`,
    );

    if (!positionReport) {
      throw new Error("No location data found");
    }

    const address = await this.#authorizedFetch(
      `/platform/geo/address/location?latitude=${
        encodeURIComponent(positionReport.latlong[0])
      }&longitude=${encodeURIComponent(positionReport.latlong[1])}`,
    );
    return {
      ...positionReport,
      address,
    };
  }

  getTrackerHardware(trackerId: string): Promise<TrackerHardwareResponse> {
    return this.#authorizedFetch(`/device_hw_report/${trackerId}`);
  }

  getTrackerHistory(trackerId: string, from: Date, to: Date): Promise<TrackerHistoryResponse> {
    const adjustDate = (date: Date) => {
      return (date.getTime() / 1000).toFixed(0);
    }
    const timeFrom = adjustDate(from);
    const timeTo = adjustDate(to);

    const searchParams = new URLSearchParams();

    searchParams.set("time_from", timeFrom);
    searchParams.set("time_to", timeTo);
    searchParams.set("format", "json_segments");

    return this.#authorizedFetch(`/tracker/${trackerId}/positions?${searchParams.toString()}`);
  }
}
