import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
} from 'chroneli';

/* Size comes from the `size` prop, never a `size-*` class: the prop is what
 * drives `data-size`, and the fallback's text step and the badge's dimensions
 * both key off that attribute. Sizing with a class shrinks the circle and
 * leaves the initials at the larger step, which clips them. */

export function Fallback() {
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>BO</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>AC</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>MK</AvatarFallback>
      </Avatar>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex items-center gap-3">
      <Avatar size="sm">
        <AvatarFallback>BO</AvatarFallback>
      </Avatar>
      <Avatar size="default">
        <AvatarFallback>BO</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>BO</AvatarFallback>
      </Avatar>
    </div>
  );
}

export function WithBadge() {
  return (
    <div className="flex items-center gap-4">
      <Avatar size="lg">
        <AvatarFallback>BO</AvatarFallback>
        <AvatarBadge />
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>AC</AvatarFallback>
        <AvatarBadge className="bg-destructive" />
      </Avatar>
    </div>
  );
}

export function Group() {
  return (
    <AvatarGroup>
      <Avatar size="lg">
        <AvatarFallback>BO</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>AC</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>MK</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+4</AvatarGroupCount>
    </AvatarGroup>
  );
}
