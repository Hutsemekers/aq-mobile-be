export enum BelAirColor {
    Red = 'red',
    Green = 'green',
    Blue = 'blue',
}

// found from user-location-list.service.ts
export interface UserLocation {
    id?: number;
    label?: string;
    type: 'user' | 'current';
    isCurrentVisible?: boolean;
    date?: Date;
    longitude?: number;
    latitude?: number;
    postalCode?: string;
}

export interface IBarChartData {
    data: IBarChartDataItem[];
    labels: string[];
}

export interface IBarChartDataItem {
    value: number;
    background: string;
}
