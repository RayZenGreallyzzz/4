import * as THREE from 'three';

/** The model's left/right axis depends on the facing direction, but its
 * front/back depth is always along the facing axis, not the camera direction.
 */
export function characterDepthAxis(direction = 'z+') {
  return /^[x][+-]$/.test(direction) ? 'x' : 'z';
}

/**
 * Select the interior between front and rear intersections of the SAME mesh.
 * Back intersections are computed by raycasting back towards the camera from
 * behind the character; they need not be back-face visible from the front.
 * For an ambiguous shell or overlapping limbs, use a conservative inset
 * rather than placing a point halfway through the entire character.
 */
export function chooseJointSnapPoint(frontHits, backHits, height, jointName, rayDirection) {
  const first = frontHits?.[0];
  if (!first?.point?.isVector3 || !rayDirection?.isVector3) return null;
  const unit = rayDirection.clone().normalize();
  if (unit.lengthSq() < .5) return null;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const name = String(jointName || '');
  const narrow = /Arm|Hand|Leg|Foot|Toe|Shoulder|Ear|Tail|Wing/i.test(name);
  const maxWidth = (narrow ? .19 : /Head|Neck/i.test(name) ? .27 : .48) * h;
  const rear = (backHits || []).find(hit => hit.object === first.object &&
    hit.point?.isVector3 && hit.point.clone().sub(first.point).dot(unit) > h * .003);
  if (rear) {
    const thickness = rear.point.clone().sub(first.point).dot(unit);
    if (thickness >= h * .008 && thickness <= maxWidth) {
      return {
        point: first.point.clone().addScaledVector(unit, thickness * .5),
        method: 'midpoint',
        thickness
      };
    }
  }
  const inset = h * (narrow ? .015 : .03);
  return {
    point: first.point.clone().addScaledVector(unit, inset),
    method: 'surface-fallback',
    thickness: null
  };
}

/** Lock one character-local depth coordinate after camera-space dragging. */
export function preserveJointDepth(position, original, direction = 'z+') {
  const result = position.clone();
  const axis = characterDepthAxis(direction);
  result[axis] = original[axis];
  return result;
}
