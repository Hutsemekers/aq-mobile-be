import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import {DataPointForDay} from '../../Interfaces';

@Component({
    selector: 'app-information-item',
    templateUrl: './information-item.component.html',
    styleUrls: ['./information-item.component.scss'],
})
export class InformationItemComponent implements OnInit {
    @Output() backClicked = new EventEmitter();

    @Input() detailedDataPoint: DataPointForDay;
    @Input() isButton = false;
    @Input() hasBackBtn = false;

    constructor() {}

    ngOnInit() {}

    goBack() {
        this.backClicked.emit();
    }
}
