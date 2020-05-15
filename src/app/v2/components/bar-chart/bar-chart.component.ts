import { Component, OnInit, Input } from '@angular/core';
import { IBarChartData } from '../../Interfaces';

@Component({
    selector: 'app-bar-chart',
    templateUrl: './bar-chart.component.html',
    styleUrls: ['./bar-chart.component.scss'],
})
export class BarChartComponent implements OnInit {
    @Input() max = 0;
    @Input() worldMax = 0;
    @Input() euMax = 0;
    @Input() options: IBarChartData;

    constructor() {}

    ngOnInit() {}

    getLines(value: number) {
        return new Array(value / 10);
    }
}