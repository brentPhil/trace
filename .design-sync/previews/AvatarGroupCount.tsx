import { AvatarGroup, Avatar, AvatarFallback, AvatarGroupCount } from 'chroneli';

/* The overflow marker at the end of a stack. It sizes itself from the group's
 * avatars via group-has-data-[size=*], so it belongs inside AvatarGroup. */

export function OverflowMarker() {
  return (
    <div className="flex flex-col gap-4">
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
      <AvatarGroup>
        <Avatar>
          <AvatarFallback>BO</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>AC</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+12</AvatarGroupCount>
      </AvatarGroup>
    </div>
  );
}
