/**
 * The Listing draft card (marketplace P11, plan 8.3; screen 09): a store item the game's agent made,
 * as its own `genex shop add --json` answered (`item_drafted`, a record only the host writes). It
 * shows the item's picture, name and description, its price, the "Other games can use it" toggle
 * and where its sale stands: a draft goes on sale when the game is published (Studio puts it on
 * sale then, `core/local-items.ts`), and an item an admin took off sale offers nothing (D14). The
 * toggle goes to genex.games through main (`itemSetShared`) as the person's own: the agent can
 * neither press it nor draw the card (D40). Changes are the agent's: the chat's composer below, or
 * Ask for changes on the Shop tab (`onAsk`). A local draft (made before the game is on Genex) is
 * the item's card on genex.games once the publish uploaded it, with what became of it.
 */
import type { JSX } from "react";
import { useId } from "react";
import {
  isLocalDraft,
  type ListingDraft,
  type ListingRecord,
  type LocalListingDraft,
} from "../../shared/item-draft.ts";
import { ItemState, type StoreRefusal } from "../../shared/store-items.ts";
import { CoinMark } from "../play/CoinMark.tsx";
import { ItemRender } from "../play/ItemRender.tsx";
import { coinNumber, coinText, gameText } from "../play/purchase-model.ts";
import { useItems } from "../state/hooks.ts";
import { useLocalPicture } from "./item-picture.ts";
import { LocalAction } from "../state/items.ts";
import { studio } from "../state/studio.ts";
import { Button } from "../ui/Button.tsx";
import { Switch } from "../ui/switch.tsx";
import { ITEMS_WORDS, itemRefusalWords, PLAY_STORE_WORDS } from "../words.ts";
import {
  type ListingCardView,
  ListingSale,
  type LocalCardView,
  LocalSale,
  listingCardView,
  localCard,
  localShareChange,
  shareChange,
} from "./listing-draft.ts";

const WORDS = ITEMS_WORDS;

/** The price chip: the coin and the amount, or Free. */
function Price({ coins }: { coins: number }): JSX.Element {
  if (coins === 0) return <span className="listing-chip">{PLAY_STORE_WORDS.free}</span>;
  return (
    <span className="listing-chip listing-price">
      <CoinMark size={14} />
      <span aria-hidden="true">{coinNumber(coins)}</span>
      <span className="sr-only">{coinText(coins)}</span>
    </span>
  );
}

/** Where the item's sale stands: on sale, off sale, or a draft that goes on sale with the game's publish. */
function SaleState({ view }: { view: ListingCardView }): JSX.Element {
  if (view.sale === ListingSale.OnSale)
    return (
      <p className="listing-sale-state" data-listing-on-sale>
        {WORDS.onSale}
      </p>
    );
  if (view.state === ItemState.Draft) return <p className="listing-local-status">{WORDS.draftStatus}</p>;
  return <p className="listing-sale-state">{WORDS.offSale}</p>;
}

/** How the person changes the item: Ask for changes where the card has one (Shop), else the chat's composer below. */
function AskForChanges({ onAsk }: { onAsk?: (() => void) | undefined }): JSX.Element {
  if (!onAsk) return <p className="listing-or">{WORDS.askBelow}</p>;
  return (
    <div className="listing-actions">
      <Button variant="outline" data-listing-ask onClick={onAsk}>
        {WORDS.askForChanges}
      </Button>
    </div>
  );
}

/** The card for one draft: an item on genex.games, or a local draft; `onAsk` asks the game's agent to change it. */
export function ListingDraftCard({ draft, onAsk }: { draft: ListingRecord; onAsk?: () => void }): JSX.Element {
  if (isLocalDraft(draft)) return <LocalListingCard draft={draft} onAsk={onAsk} />;
  return <ItemListingCard draft={draft} onAsk={onAsk} />;
}

/**
 * An item on genex.games. `note` says what became of a local draft its game's publish uploaded, and
 * `settled` why genex.games refused to put it on sale then; a later press's own refusal wins. A
 * `locked` card shows content Genex no longer holds: it offers neither Put on sale nor sharing.
 */
function ItemListingCard({
  draft,
  note = null,
  settled = null,
  locked = false,
  onAsk,
}: {
  draft: ListingDraft;
  note?: string | null;
  settled?: StoreRefusal | null;
  locked?: boolean;
  onAsk?: (() => void) | undefined;
}): JSX.Element {
  // A press's answer is the newest; else Selling's row, which follows a sale Studio made after a publish.
  const pressed = useItems((s) => s.changed[draft.itemId]);
  const listed = useItems((s) => s.selling.selling?.items.find((row) => row.id === draft.itemId));
  const latest = pressed ?? (listed ? { state: listed.state, shareable: listed.shareable } : undefined);
  const busy = useItems((s) => s.busy[draft.itemId]);
  const refusal = useItems((s) => s.refused[draft.itemId]) ?? settled ?? undefined;
  const view = listingCardView(draft, latest, busy, refusal);
  const shareId = useId();
  const name = gameText(view.name);
  return (
    <section
      className="listing-card"
      data-listing-draft={view.itemId}
      data-listing-sale={view.sale}
      aria-label={WORDS.listingLabel(name)}
    >
      <div className="listing-head">
        <ItemRender
          item={{ id: view.itemId, iconUrl: view.iconUrl ?? listed?.iconUrl ?? null, modelUrl: null }}
          className="listing-render"
        />
        <div className="listing-words">
          <h3 className="listing-name" dir="auto">
            {name}
          </h3>
          {view.description && (
            <p className="listing-description" dir="auto">
              {gameText(view.description)}
            </p>
          )}
        </div>
      </div>
      <div className="listing-chips">
        <Price coins={view.priceCoins} />
        <span className="listing-chip listing-share">
          <Switch
            id={shareId}
            data-listing-share={view.itemId}
            checked={view.shared}
            disabled={!view.canShare || locked}
            aria-busy={view.sharing || undefined}
            onCheckedChange={(on) => void studio().items.change(view.itemId, shareChange(on))}
          />
          <label htmlFor={shareId}>{WORDS.shared}</label>
        </span>
      </div>
      <SaleState view={view} />
      {!locked && <AskForChanges onAsk={onAsk} />}
      {note && (
        <p className="listing-note" data-listing-stayed-draft>
          {note}
        </p>
      )}
      {view.refusal && (
        <p role="alert" className="listing-refusal">
          {itemRefusalWords(view.refusal)}
        </p>
      )}
    </section>
  );
}

/** A local draft: the item's own card once its game's publish uploaded it, else its local card. */
function LocalListingCard({
  draft,
  onAsk,
}: {
  draft: LocalListingDraft;
  onAsk?: (() => void) | undefined;
}): JSX.Element {
  const view = useItems((s) => s.local[draft.project]);
  const busy = useItems((s) => s.localBusy[draft.localId]);
  const failed = useItems((s) => s.localFailed[draft.localId] === true);
  const card = localCard(draft, view, busy, failed);
  if ("uploaded" in card)
    return (
      <ItemListingCard
        draft={card.uploaded}
        note={uploadedNote(card)}
        settled={card.refusal}
        locked={card.unseen}
        onAsk={onAsk}
      />
    );
  return <LocalCard view={card.local} onAsk={onAsk} />;
}

/** What an uploaded local draft's card says of it: a version it never showed, or a change since approval. */
function uploadedNote(card: { changed: boolean; unseen: boolean }): string | null {
  if (card.unseen) return WORDS.unseenVersion;
  return card.changed ? WORDS.stayedDraft : null;
}

/** A local draft's card: it goes on sale when the game is published. */
function LocalCard({ view, onAsk }: { view: LocalCardView; onAsk?: (() => void) | undefined }): JSX.Element {
  const shareId = useId();
  const { draft } = view;
  const picture = useLocalPicture(draft.project, draft.picture, draft.contentHash);
  const name = gameText(draft.name);
  const sharing = view.busy === LocalAction.Share || view.busy === LocalAction.Unshare;
  return (
    <section
      className="listing-card"
      data-listing-draft={draft.localId}
      data-listing-local={view.sale}
      aria-label={WORDS.listingLabel(name)}
    >
      <div className="listing-head">
        <ItemRender item={{ id: draft.localId, iconUrl: picture, modelUrl: null }} className="listing-render" />
        <div className="listing-words">
          <h3 className="listing-name" dir="auto">
            {name}
          </h3>
          <p className="listing-local-status" data-listing-local-status>
            {WORDS.draftStatus}
          </p>
          {draft.description && (
            <p className="listing-description" dir="auto">
              {gameText(draft.description)}
            </p>
          )}
        </div>
      </div>
      <div className="listing-chips">
        <Price coins={draft.priceCoins} />
        <span className="listing-chip listing-share">
          <Switch
            id={shareId}
            data-listing-share={draft.localId}
            checked={view.shared}
            disabled={!view.canShare}
            aria-busy={sharing || undefined}
            onCheckedChange={(on) => void studio().items.pressLocal(draft, localShareChange(on))}
          />
          <label htmlFor={shareId}>{WORDS.shared}</label>
        </span>
      </div>
      {view.sale === LocalSale.Removed ? (
        <p className="listing-sale-state">{WORDS.localRemoved}</p>
      ) : (
        <AskForChanges onAsk={onAsk} />
      )}
      {view.refusal && (
        <p role="alert" className="listing-refusal">
          {itemRefusalWords(view.refusal)}
        </p>
      )}
      {view.failed && (
        <p role="alert" className="listing-refusal">
          {WORDS.localFailed}
        </p>
      )}
    </section>
  );
}
