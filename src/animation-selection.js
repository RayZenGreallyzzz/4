// A source animation library is not the same thing as the saved action set.
// Imported clips are staged but NOT exported until explicitly checked and
// confirmed. On opening a GLB, its existing actions are preserved by default;
// the user can deselect any of them, even if that GLB already has 159 actions.
export class AnimationSelection {
 constructor(clips=[]){
  this.draft=new Set(clips.map(c=>c.uuid));
  this.saved=new Set(this.draft);
 }
 isChecked(clip){return Boolean(clip&&this.draft.has(clip.uuid));}
 isSaved(clip){return Boolean(clip&&this.saved.has(clip.uuid));}
 isDirty(){
  return this.draft.size!==this.saved.size||
    [...this.draft].some(id=>!this.saved.has(id));
 }
 mark(clip,checked){
  if(!clip?.uuid)return;
  if(checked)this.draft.add(clip.uuid);
  else this.draft.delete(clip.uuid);
 }
 markAll(clips,checked){
  for(const clip of clips||[])this.mark(clip,checked);
 }
 // Manually authored clip has its OWN explicit 'Save action' command.
 addManual(clip){
  if(!clip?.uuid)return;
  this.draft.add(clip.uuid);
  this.saved.add(clip.uuid);
 }
 // Pressing "Save selected in set" commits precisely these checked actions.
 commit(clips){
  const available=new Set(clips.map(clip=>clip.uuid));
  this.draft=new Set([...this.draft].filter(id=>available.has(id)));
  this.saved=new Set(this.draft);
  return this.saved.size;
 }
 selected(clips){
  return clips.filter(clip=>this.saved.has(clip.uuid)&&clip.tracks?.length);
 }
 counts(clips){
  return {
   all:clips.length,
   checked:clips.filter(clip=>this.draft.has(clip.uuid)).length,
   saved:clips.filter(clip=>this.saved.has(clip.uuid)).length,
   pending:clips.filter(clip=>!this.saved.has(clip.uuid)).length
  };
 }
}
