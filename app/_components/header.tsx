"use client";

import Link from "next/link";
import { IconPlusFill18 } from "@/_components/ui/icons";
import { Button } from "@/_components/ui/button";
import { Icon } from "@/_components/ui/icon";
import { Typography } from "@/_components/ui/typography";

interface HeaderProps {
  onOpenAdd: () => void;
}

function Header({ onOpenAdd }: HeaderProps) {
  return (
    <header className="flex items-center justify-between">
      <Typography variant="h1" className="text-foreground">
        Alcove
      </Typography>
      <div className="flex items-center gap-2">
        <Button asChild variant="quiet" aria-label="View map">
          <Link href="/map">Map</Link>
        </Button>
        <Button
          aria-label="Add apartment"
          onClick={onOpenAdd}
          data-add-apartment-trigger
        >
          <Icon glyph={IconPlusFill18} size={14} />
          Add
        </Button>
      </div>
    </header>
  );
}

export { Header };
