/** A committed result can arrive before map/view admission or after reconnect.
 * Its roster is sufficient for the HUD; scene preparation is not a prerequisite.
 * This presentation step does not acknowledge the result or alter its awards. */
export function showAcceptedOnlineResult(receipt,{pvp,entry,lobby,hud,presentation}){
  entry.clear();
  lobby?.show(false);
  hud.clear();
  hud.update(pvp,{localId:receipt.playerId});
  hud.show(true);
  presentation.present(receipt.result);
}
