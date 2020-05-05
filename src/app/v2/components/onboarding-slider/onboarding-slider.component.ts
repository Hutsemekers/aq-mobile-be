import {Component, OnInit, ViewChild} from '@angular/core';
import {IonSlides, NavController} from '@ionic/angular';
import {animate, keyframes, state, style, transition, trigger, } from '@angular/animations';

import {NotificationType, UserNotificationSetting} from '../user-notification-settings/user-notification-settings.component';

@Component({
    selector: 'app-onboarding-slider',
    templateUrl: './onboarding-slider.component.html',
    styleUrls: ['./onboarding-slider.component.scss'],
    animations: [
        trigger('bounce', [
            state(
                '*',
                style({
                    transform: 'translateX(0)',
                })
            ),
            transition(
                '* => rightSwipe',
                animate(
                    '700ms ease-out',
                    keyframes([
                        style({
                            transform: 'translateX(0)',
                            offset: 0,
                        }),
                        style({
                            transform: 'translateX(-65px)',
                            offset: 0.3,
                        }),
                        style({
                            transform: 'translateX(0)',
                            offset: 1.0,
                        }),
                    ])
                )
            ),
            transition(
                '* => leftSwipe',
                animate(
                    '700ms ease-out',
                    keyframes([
                        style({
                            transform: 'translateX(0)',
                            offset: 0,
                        }),
                        style({
                            transform: 'translateX(65px)',
                            offset: 0.3,
                        }),
                        style({
                            transform: 'translateX(0)',
                            offset: 1.0,
                        }),
                    ])
                )
            ),
        ]),
    ],
})
export class OnboardingSliderComponent implements OnInit {
    @ViewChild(IonSlides) slides: IonSlides;

    btnText = 'Ga verder';
    state = 'x';
    language = 'e';

    userSettings: UserNotificationSetting[] = [
        {
            notificationType: NotificationType.highConcentration,
            enabled: true
        },
        {
            notificationType: NotificationType.transport,
            enabled: true
        },
        {
            notificationType: NotificationType.activity,
            enabled: false
        },
        {
            notificationType: NotificationType.allergies,
            enabled: true
        },
        {
            notificationType: NotificationType.exercise,
            enabled: false
        }
    ];

    constructor(public navCtrl: NavController) {}

    ngOnInit() {}

    // Logic for next button
    async next() {
        const isEnd = await this.slides.isEnd();
        if (isEnd) {
            this.navCtrl.navigateForward('v2/main');
        } else {
            this.slides.slideNext();
        }
    }

    // Changing the text when reaches the end of slides
    async slideChanged() {
        const isEnd = await this.slides.isEnd();
        if (isEnd) {
            this.btnText = 'Start de app';
        }
    }

    // Getting active and prev index for animations
    async slideMoved() {
        const activeIndex = await this.slides.getActiveIndex();
        const previousIndex = (await this.slides.getPreviousIndex()) || 0;

        if (activeIndex >= previousIndex) {
            this.state = 'rightSwipe';
        } else {
            this.state = 'leftSwipe';
        }
    }

    // Returning the state to x, so we can repeat animation
    animationDone() {
        this.state = 'x';
    }
}