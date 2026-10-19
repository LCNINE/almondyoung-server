// Shared vector artwork for the native launch image and animated web splash.
export const ATTENDANCE_CLOCK_ART = String.raw`
<defs>
<clipPath id="__CLOCK_ID__-shirt">
<path d="M178 202 Q194 209 210 198 L221 242 Q203 254 178 240 Z">
</path>
</clipPath>
<filter id="__CLOCK_ID__-shadow" x="-30%" y="-30%" width="160%" height="180%">
<feGaussianBlur stdDeviation="4">
</feGaussianBlur>
</filter>
</defs>
<g fill="none" stroke="#443D37" stroke-linecap="round" stroke-linejoin="round">
<ellipse cx="277" cy="114" rx="334" ry="279" transform="rotate(-8 277 114)" fill="#DCD5CB" stroke="none">
</ellipse>
<ellipse cx="273" cy="100" rx="334" ry="279" transform="rotate(-8 273 100)" fill="#FCFAF5" stroke-width="4.5">
</ellipse>
<ellipse cx="273" cy="100" rx="323" ry="267" transform="rotate(-8 273 100)" stroke="white" stroke-width="3">
</ellipse>
<g stroke-width="3.5" opacity=".75">
<path d="M8 197 l12 -5 M62 276 l10 -10 M156 337 l5 -13 M256 359 l1 -14 M348 351 l-3 -12">
</path>
</g>
<g stroke-width="4.5">
<path d="M2 123 C-10 109 -9 94 3 91 C18 89 22 114 8 116 M17 104 Q26 131 9 141">
</path>
<path d="M50 257 C30 263 34 243 43 241 C58 236 66 252 55 260 C44 266 45 278 57 280 C74 283 82 267 64 260 Z">
</path>
<path d="M159 332 l34 -7 q-12 23 -9 43">
</path>
<path d="M306 333 C281 332 283 368 304 370 C326 370 325 346 307 349 Q291 351 289 360">
</path>
</g>
<ellipse cx="199" cy="295" rx="45" ry="11" transform="rotate(-20 199 295)" fill="#6F6254" opacity=".09" stroke="none" filter="url(#__CLOCK_ID__-shadow)">
</ellipse>
<g class="attendance-clock-second" stroke-width="3">
<path d="M280 89 L105 296">
</path>
<path d="M277 93 L116 291" stroke="#BFB5A8" stroke-width="8" opacity=".16" transform="translate(4 6)">
</path>
</g>
<g class="attendance-clock-hand">
<path d="M281 91 L76 185" stroke="#BFB5A8" stroke-width="12" opacity=".2" transform="translate(8 10)">
</path>
<path d="M281 89 L96 171" stroke-width="7">
</path>
<path d="M108 159 Q91 158 77 173 Q57 190 28 197 Q71 192 92 184 Q110 179 113 167 Z" fill="#443D37" stroke-width="3">
</path>
<g class="attendance-clock-mascot" stroke-width="4">
<path d="M181 209 Q166 182 161 150" stroke-width="10" stroke="#443D37">
</path>
<path d="M181 209 Q166 182 161 150" stroke-width="5.5" stroke="#FCFAF5">
</path>
<path d="M207 204 Q217 167 205 132" stroke-width="10" stroke="#443D37">
</path>
<path d="M207 204 Q217 167 205 132" stroke-width="5.5" stroke="#FCFAF5">
</path>
<g class="attendance-clock-leg-left" fill="#DC8068">
<path d="M181 239 L199 249 L190 273 Q185 282 176 275 L158 263 Q152 256 158 253 Q163 250 170 258 L179 261 Z">
</path>
<path d="M174 257 l9 9" stroke="#B96251" stroke-width="2">
</path>
</g>
<g class="attendance-clock-leg-right" fill="#DC8068">
<path d="M201 241 L215 237 L232 257 Q242 264 249 253 Q253 245 258 249 Q264 257 255 268 Q248 277 236 271 L216 260 Z">
</path>
<path d="M223 254 l10 8" stroke="#B96251" stroke-width="2">
</path>
</g>
<path d="M178 202 Q194 209 210 198 L221 242 Q203 254 178 240 Z" fill="#FFFDF8">
</path>
<g clip-path="url(#__CLOCK_ID__-shirt)" stroke="#EFB473" stroke-width="6">
<path d="M168 211 Q193 225 219 209 M169 224 Q194 238 223 222 M173 237 Q197 250 224 235">
</path>
</g>
<path d="M178 202 Q194 209 210 198 L221 242 Q203 254 178 240 Z">
</path>
<path d="M166 182 C163 166 177 154 190 154 C207 150 222 163 220 181 C219 201 204 214 186 209 C173 206 167 195 166 182 Z" fill="#FFFDF8">
</path>
<path d="M188 155 q-9 -13 -15 -3 M194 154 q2 -9 7 -7" stroke-width="3">
</path>
<g stroke="none" fill="#F1B6AF">
<ellipse cx="179" cy="190" rx="5" ry="3.5" transform="rotate(-16 179 190)">
</ellipse>
<ellipse cx="207" cy="184" rx="5" ry="3.5" transform="rotate(-16 207 184)">
</ellipse>
</g>
<g class="attendance-clock-eyes" stroke-width="3.5">
<path d="M176 177 q5 -6 10 -2 M197 172 q5 -6 10 -2">
</path>
<path d="M181 177 l0 2 M202 172 l0 2">
</path>
</g>
<path d="M190 187 q4 4 8 -2" stroke-width="2.5">
</path>
<path d="M186 182 l4 -2" stroke-width="2">
</path>
<path d="M156 155 Q152 146 157 141 Q163 137 167 144 L168 150" fill="#FFFDF8" stroke-width="3.5">
</path>
<path d="M199 138 Q195 129 200 124 Q206 120 210 126 L211 132" fill="#FFFDF8" stroke-width="3.5">
</path>
</g>
</g>
<g stroke-width="4.5">
<path d="M248 71 L248 99 Q248 113 280 113 Q312 112 312 98 L312 70" fill="#443D37">
</path>
<path d="M249 87 Q281 101 312 86 M249 98 Q281 111 311 96" stroke="#6A5B4B" stroke-width="2">
</path>
<ellipse cx="280" cy="69" rx="32" ry="18" fill="#FCFAF5">
</ellipse>
<path d="M263 60 q9 -4 18 -3" stroke="white" stroke-width="6">
</path>
</g>
</g>
`;

// Outlined title keeps native launch rendering independent of server fonts.
export const ATTENDANCE_SPLASH_TITLE_WIDTH = 109.06;
export const ATTENDANCE_SPLASH_TITLE = String.raw`
<g transform="scale(0.02 -0.02)">
<path transform="translate(0 0)" d="M727 812H608V-79H727V373H859V470H727ZM37 432C37 245 123 115 268 115C414 115 499 246 499 432C499 620 414 751 268 751C123 751 37 620 37 432ZM387 432C387 292 337 209 268 209C201 209 151 292 151 432C151 573 201 657 268 657C337 657 387 573 387 432Z"/>
<path transform="translate(865 0)" d="M728 448V780H137V448H372V355H30V261H835V355H489V448ZM742 -55V37H249V201H133V-55ZM609 539H254V691H609Z"/>
<path transform="translate(1730 0)" d="M835 131H30V38H835ZM742 319V412H249V643H734V737H133V319Z"/>
<path transform="translate(2595 0)" d="M768 100C768 211 655 280 462 280C269 280 157 211 157 100C157 -8 269 -78 462 -78C655 -78 768 -8 768 100ZM494 548C494 672 393 761 264 761C134 761 33 671 33 548C33 422 136 343 264 343C394 343 494 422 494 548ZM522 399H650V278H767V812H650V708H522C523 675 525 642 525 609H650V497H525C525 465 523 432 522 399ZM648 100C648 47 580 16 462 16C346 16 276 47 276 100C276 154 346 186 462 186C580 186 648 154 648 100ZM382 549C382 482 333 432 264 432C194 432 147 480 147 549C147 612 193 665 264 665C337 665 382 614 382 549Z"/>
<path transform="translate(3460 0)" d=""/>
<path transform="translate(3723 0)" d="M546 586C546 696 452 777 312 777C174 777 81 696 81 586C81 479 174 401 312 401C448 401 546 479 546 586ZM482 121H666V-79H782V812H666V211H482ZM374 -53V254C457 260 540 267 605 276L599 365C523 355 436 349 309 342C211 338 119 337 17 337L33 242C101 242 168 243 256 247V-53ZM430 587C430 534 383 496 312 496C245 496 198 534 198 587C198 640 246 681 312 681C381 681 430 640 430 587Z"/>
<path transform="translate(4588 0)" d="M741 715H126V623H624C624 581 622 530 619 477C445 469 270 462 94 455L109 362C277 370 446 380 614 388C607 311 598 237 585 184C622 181 661 178 697 174C723 279 741 494 741 715ZM835 39V131H30V39Z"/>
</g>
`;
