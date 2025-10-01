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

export class Tractive {
    #clientId = "6536c228870a3c8857d452e8";
    #email: string;
    #password: string;
    #accountDetails: { token: string; uid: string } | null;
    #authentication: Promise<void>;

    constructor(email: string, password: string) {
        this.#email = email;
        this.#password = password;
        this.#accountDetails = null;
        this.#authentication = this.authenticate();
    }

    async #authorizedFetch(url: string) {
        await this.#authentication;

        if (!this.isAuthenticated()) {
            throw new Error("Not authenticated");
        }

        const headers = new Headers();

        headers.set("X-Tractive-Client", this.#clientId);
        headers.set("Authorization", `Bearer ${this.#accountDetails!.token}`);
        headers.set("Content-Type", "application/json");

        const response = await fetch("https://graph.tractive.com/4" + url, {
            headers,
        });

        return response.json();
    }

    isAuthenticated() {
        if (this.#accountDetails?.token) return true;
        return false;
    }

    async authenticate() {
        const url = new URL("https://graph.tractive.com/4/auth/token");

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

    getTracker(trackerId: string): Promise<TrackerResponse> {
        return this.#authorizedFetch(`/tracker/${trackerId}`);
    }

    async getTrackerLocation(
        trackerId: string,
    ): Promise<TrackerLocationResponse> {
        const positionReport = await this.#authorizedFetch(
            `/device_pos_report/${trackerId}`,
        );
        const address = await this.#authorizedFetch(
            `/platform/geo/address/location?latitude=${encodeURIComponent(positionReport.latlong[0])
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
}
