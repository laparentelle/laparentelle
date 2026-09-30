/**
 * Builds the inline `onclick` opener for the shared booking dialog
 * (`BookDialog.astro`, rendered once per page by the base layout).
 *
 * The dialog is filled at click time from the embedded JSON payload:
 * normal sessions show the planning form, externally-booked sessions
 * show the redirect message + practitioner booking link instead.
 *
 * NOTE: this string is assembled by concatenation, so brace/paren counting
 * is manual — after any edit, verify with `node --check` on a rendered
 * `onclick` attribute (see AGENTS.md).
 */

export interface BookOpenerPerson {
  name: string;
  url?: string | null;
  bookingUrl?: string | null;
}

export interface BookOpenerInput {
  /** Session story UUID (the booking key). */
  uid: string;
  title?: string;
  /** ISO start, stored in the hidden form field. */
  startISO: string;
  capacity?: string | number;
  note?: string;
  external: boolean;
  people: BookOpenerPerson[];
  /** Human label shown in the dialog, e.g. "mercredi 30 septembre à 18:30". */
  label: string;
}

export function buildBookOpener(input: BookOpenerInput): string {
  const { uid, title, startISO, capacity, note, external, people, label } = input;
  return (
    `(function(){const d=document.getElementById('book-dialog');if(!d)return;` +
    `const ext=${JSON.stringify(external)};` +
    `const titleEl=d.querySelector('.book-title');if(titleEl)titleEl.textContent=ext?'Réservation directe':'Demande de réservation';` +
    `const formEl=d.querySelector('#book-form');if(formEl)formEl.hidden=ext;` +
    `const extBox=d.querySelector('[data-book-external]');if(extBox)extBox.hidden=!ext;` +
    `d.querySelector('[name=session_uid]').value='${uid}';` +
    `d.querySelector('[name=session_title]').value=${JSON.stringify(title ?? "")};` +
    `d.querySelector('[name=session_start]').value='${startISO}';` +
    `d.querySelector('[name=session_capacity]').value='${capacity ?? ""}';` +
    `const t=d.querySelector('[data-book-when]');if(t)t.textContent=${JSON.stringify(label)};` +
    `const n=d.querySelector('[data-book-note]');if(n){const v=${JSON.stringify(note ?? "")};n.textContent=v;n.hidden=!v;}` +
    `const list=${JSON.stringify(people)};` +
    `if(ext){const links=d.querySelector('[data-book-external-links]');if(links){links.textContent='';` +
    `const targets=list.map((p)=>({name:p.name,href:p.bookingUrl||p.url}));` +
    `const withUrl=targets.filter((p)=>p.href);` +
    `for(const p of withUrl){const a=document.createElement('a');a.className='book-external-btn';a.href=p.href;a.target='_blank';a.rel='noopener';` +
    `a.textContent=targets.length>1?('Réserver avec '+p.name):'Réserver directement';links.appendChild(a);}` +
    `const withPage=list.filter((p)=>!p.bookingUrl&&p.url);` +
    `for(const p of withPage){const a=document.createElement('a');a.className='book-external-page';a.href=p.url;a.target='_blank';a.rel='noopener';` +
    `a.textContent=list.length>1?('Voir la fiche de '+p.name):'Voir la fiche du praticien';links.appendChild(a);}}}` +
    `const noUrl=d.querySelector('[data-book-external-noname]');if(noUrl){` +
    `const names=list.filter((p)=>!p.bookingUrl&&!p.url).map((p)=>p.name);` +
    `if(!list.some((p)=>p.bookingUrl||p.url)&&names.length){noUrl.textContent='Contactez directement '+names.join(', ')+' pour réserver.';noUrl.hidden=false;}` +
    `else{noUrl.textContent='';noUrl.hidden=true;}}` +
    `const box=d.querySelector('[data-book-people]');const lab=d.querySelector('[data-book-people-label]');` +
    `const aside=d.querySelector('.book-aside');let has=false;if(box){box.textContent='';` +
    `if(!ext&&list.length){has=true;if(lab)lab.hidden=false;box.hidden=false;` +
    `for(const p of list){const a=document.createElement(p.url?'a':'div');a.className='book-person';` +
    `if(p.url){a.href=p.url;a.target='_blank';a.rel='noopener';}` +
    `const nm=document.createElement('span');nm.className='book-person-name';nm.textContent=p.name;a.appendChild(nm);` +
    `if(p.url){const c=document.createElement('span');c.className='book-person-cta';c.textContent='Voir la fiche';a.appendChild(c);}` +
    `box.appendChild(a);}}` +
    `else{if(lab)lab.hidden=true;box.hidden=true;}}` +
    `if(aside){const note=n&&!n.hidden;aside.hidden=ext?true:(!has&&!note);}` +
    `d.showModal();})()`
  );
}
