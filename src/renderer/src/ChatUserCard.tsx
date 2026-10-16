import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Ban, MessageSquare, Undo2, X } from "lucide-react";
import type { ChatBadgeAsset, ChatMessage } from "../../shared/chat";
import type { ChatUserProfile } from "../../shared/twitch";
import { parseChannelKey } from "../../shared/platform";
import {
  blockChatter,
  unblockChatter,
  useBlockedChatters,
} from "./blocked-chatters";
import { ChatBadge } from "./ChatBadge";
import "./chat-user-card.css";

// Memoized so an open card doesn't re-tokenize every retained message each
// time the parent re-renders (the chat batch fires ~10x/second). A row's
// content is immutable once shown, so identity-stable props never re-render it.
const UserCardMessage = memo(function UserCardMessage({
  message,
  renderText,
}: {
  message: ChatMessage;
  renderText: (message: ChatMessage) => ReactNode;
}) {
  return (
    <article>
      <time>
        {new Date(message.sentAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}
      </time>
      <div>{renderText(message)}</div>
    </article>
  );
});

interface ChatUserCardProps {
  /**
   * The document to open in. Chat can be rendered into a window of its own,
   * and a card that puts itself in this window is left behind on the wrong
   * screen, measured against the wrong viewport.
   */
  root?: Document;
  anchor?: DOMRect;
  badges: Map<string, ChatBadgeAsset>;
  channel: string;
  messages: ChatMessage[];
  onClose: () => void;
  renderText: (message: ChatMessage) => ReactNode;
  selected: ChatMessage;
}

interface CardPosition {
  left: number;
  top: number;
}

function clampCardPosition(
  position: CardPosition,
  width: number,
  height: number,
): CardPosition {
  const margin = 8;
  const left = Math.max(
    margin,
    Math.min(Math.max(margin, window.innerWidth - width - margin), position.left),
  );
  const top = Math.max(
    margin,
    Math.min(Math.max(margin, window.innerHeight - height - margin), position.top),
  );
  return left === position.left && top === position.top
    ? position
    : { left, top };
}

function formatDate(value: string | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleDateString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function badgeSubscriptionLabel(badgeKeys: string[]): string | null {
  const founder = badgeKeys.find((key) => key.startsWith("founder/"));
  if (founder) return "Founder";
  const subscriber = badgeKeys.find((key) => key.startsWith("subscriber/"));
  if (!subscriber) return null;
  const months = Number(subscriber.split("/")[1]);
  return Number.isFinite(months) && months > 0 ? `Subscriber badge (${months}+ months)` : "Subscriber";
}

function tierLabel(tier: string | undefined): string {
  if (tier === "3000" || tier === "3") return "Tier 3";
  if (tier === "2000" || tier === "2") return "Tier 2";
  return "Tier 1";
}

export function ChatUserCard({
  anchor,
  badges,
  channel,
  messages,
  onClose,
  renderText,
  root = document,
  selected,
}: ChatUserCardProps) {
  // The window the card opens in, so it is measured against that viewport.
  const view = root.defaultView ?? window;
  const isAndroid = window.violetwireRuntime?.platform === "android";
  const [profile, setProfile] = useState<ChatUserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<CardPosition | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [label, setLabel] = useState<{
    name: string; left: number; top: number;
  } | null>(null);
  const labelAnchor = useRef<HTMLElement | null>(null);
  const labelTimer = useRef<number | undefined>(undefined);
  const hideLabel = useCallback(() => {
    view.clearTimeout(labelTimer.current);
    labelAnchor.current = null;
    setLabel(null);
  }, [view]);
  useEffect(() => {
    hideLabel();
    view.addEventListener("resize", hideLabel);
    return () => {
      view.clearTimeout(labelTimer.current);
      view.removeEventListener("resize", hideLabel);
    };
  }, [hideLabel, view, selected.login]);
  const showLabel = (event: React.MouseEvent<HTMLElement>) => {
    const element = (event.target as Element).closest<HTMLElement>("[data-chat-card-label], [data-emote-name]");
    if (!element) return;
    const name = element.dataset.chatCardLabel ?? element.dataset.emoteName;
    if (!name) return;
    event.preventDefault();
    event.stopPropagation();
    view.clearTimeout(labelTimer.current);
    labelAnchor.current = element;
    setLabel(positionLabel(element, name));
    labelTimer.current = view.setTimeout(hideLabel, 2000);
  };
  const positionLabel = (element: HTMLElement, name: string) => {
    const bounds = element.getBoundingClientRect();
    const halfWidth = Math.min(160, Math.max(35, name.length * 3.6 + 11));
    return {
      name,
      left: Math.max(halfWidth + 10, Math.min(
        view.innerWidth - halfWidth - 10, bounds.left + bounds.width / 2,
      )),
      top: bounds.top - 8,
    };
  };
  const dragOffset = useRef<{ x: number; y: number } | null>(null);
  const messagesHost = useRef<HTMLDivElement>(null);
  // Newest messages sit at the bottom; open there and stay pinned while the
  // reader hasn't scrolled up into the history.
  const stickToNewest = useRef(true);
  const userMessages = useMemo(
    () => messages.filter((message) => message.login.toLowerCase() === selected.login.toLowerCase()).slice(-40),
    [messages, selected.login],
  );
  const badgeKeys = useMemo(
    () => [...new Set([...selected.badges, ...userMessages.flatMap((message) => message.badges)])],
    [selected.badges, userMessages],
  );
  const badgeAssets = useMemo(() => {
    const assets = new Map<string, ChatBadgeAsset>();
    for (const asset of [
      ...(selected.badgeAssets ?? []),
      ...userMessages.flatMap((message) => message.badgeAssets ?? []),
    ]) {
      assets.set(asset.key, asset);
    }
    return [...assets.values()];
  }, [selected.badgeAssets, userMessages]);
  const badgeSubscription = badgeSubscriptionLabel(badgeKeys);
  const target = useMemo(() => parseChannelKey(channel), [channel]);
  const login = (profile?.login ?? selected.login).toLowerCase();
  const blocked = useBlockedChatters().has(login);

  useEffect(() => {
    let cancelled = false;
    setProfile(null); setError(null);
    const request =
      target.platform === "kick"
        ? window.desktop.kick.getChatUserProfile(target.login, selected.login, selected.displayName)
        : window.desktop.twitch.getChatUserProfile(target.login, selected.login);
    void request
      .then((value) => {
        if (!cancelled) setProfile(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Profile details unavailable.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected.login, selected.displayName, target.login, target.platform]);

  useLayoutEffect(() => {
    const host = messagesHost.current;
    if (host && stickToNewest.current) host.scrollTop = host.scrollHeight;
  }, [userMessages]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    view.addEventListener("keydown", closeOnEscape);
    return () => view.removeEventListener("keydown", closeOnEscape);
  }, [onClose, view]);

  useLayoutEffect(() => {
    if (isAndroid || !anchor || !cardRef.current) return;
    const card = cardRef.current;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const margin = 8;
    let left = anchor.right + 10;
    if (left + width > view.innerWidth - margin) left = anchor.left - width - 10;
    left = Math.max(margin, Math.min(view.innerWidth - width - margin, left));
    const top = Math.max(
      margin,
      Math.min(view.innerHeight - height - margin, anchor.top - 8),
    );
    setPosition({ left, top });
  }, [anchor, selected.login, view, isAndroid]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    setPosition((current) =>
      current
        ? clampCardPosition(current, card.offsetWidth, card.offsetHeight)
        : current,
    );
  }, [error, profile]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const keepCardOnScreen = () => {
      setPosition((current) =>
        current
          ? clampCardPosition(current, card.offsetWidth, card.offsetHeight)
          : current,
      );
    };
    const observer = new ResizeObserver(keepCardOnScreen);
    observer.observe(card);
    view.addEventListener("resize", keepCardOnScreen);
    return () => {
      observer.disconnect();
      view.removeEventListener("resize", keepCardOnScreen);
    };
  }, [view]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && typeof target.nodeType === "number" && !cardRef.current?.contains(target)) {
        onClose();
      }
    };
    const moveCard = (event: PointerEvent) => {
      const offset = dragOffset.current;
      const card = cardRef.current;
      if (!offset || !card) return;
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      setPosition(
        clampCardPosition(
          { left: event.clientX - offset.x, top: event.clientY - offset.y },
          width,
          height,
        ),
      );
    };
    const stopDrag = () => {
      dragOffset.current = null;
    };
    view.addEventListener("pointerdown", closeOnOutsidePointer);
    view.addEventListener("pointermove", moveCard);
    view.addEventListener("pointerup", stopDrag);
    return () => {
      view.removeEventListener("pointerdown", closeOnOutsidePointer);
      view.removeEventListener("pointermove", moveCard);
      view.removeEventListener("pointerup", stopDrag);
    };
  }, [onClose, view]);

  const ivrSubscription = profile?.subage?.subscription;
  const subscription = profile?.relationship?.subscription;
  const subscriptionText = ivrSubscription
    ? ivrSubscription.isHidden
      ? "Subscription status hidden"
      : ivrSubscription.isSubscribed
        ? `${tierLabel(ivrSubscription.tier)} · ${ivrSubscription.cumulativeMonths} months`
        : ivrSubscription.cumulativeMonths > 0
          ? `Previously subscribed · ${ivrSubscription.cumulativeMonths} months`
          : "Not subscribed"
    : subscription
      ? subscription.isSubscribed
        ? target.platform === "kick"
          ? `Subscribed${subscription.months ? ` · ${subscription.months} months` : ""}${subscription.since ? ` · since ${formatDate(subscription.since)}` : ""}`
          : `${tierLabel(subscription.tier)}${subscription.isGift ? " (gifted)" : ""}`
        : "Not subscribed"
      : (badgeSubscription ?? "Unavailable");

  const openProfile = () => {
    if (!isAndroid) return;
    onClose();
    const key = `${target.platform === "kick" ? "kick:" : ""}${login}`;
    window.dispatchEvent(new CustomEvent("android-open-profile", { detail: key }));
  };

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (isAndroid) return;
    const pressed = event.target as Element | null;
    // Not `instanceof`: failing this in the chat window started a drag on every
    // button, which then swallowed the click that should have followed.
    const onButton = pressed?.nodeType === 1 && pressed.closest("button") !== null;
    if (event.button !== 0 || onButton) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setPosition({ left: rect.left, top: rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  return createPortal(
    <section
      onClickCapture={showLabel}
      role="dialog"
      aria-modal={isAndroid || undefined}
      aria-label={`${selected.displayName} profile`}
      className={`chat-user-card${position ? " positioned" : ""}`}
      ref={cardRef}
      style={position ?? undefined}
    >
        <header onPointerDown={beginDrag}>
          <button className="chat-user-profile-avatar" aria-label="Open channel profile" onClick={openProfile} disabled={!isAndroid} type="button">
          {profile?.profileImageUrl ? (
            <img alt="" className="chat-user-avatar" src={profile.profileImageUrl} />
          ) : (
            <span className="chat-user-avatar fallback">{selected.displayName.slice(0, 1).toUpperCase()}</span>
          )}
          </button>
          <button className="chat-user-profile-name" onClick={openProfile} disabled={!isAndroid} type="button">
            <strong style={{ color: selected.color || undefined }}>
              {profile?.displayName ?? selected.displayName}
            </strong>
            <small>@{profile?.login ?? selected.login}</small>
          </button>
          <button aria-label="Close user card" onClick={onClose} title="Close" type="button">
            <X size={17} />
          </button>
        </header>

        {profile?.description && <p className="chat-user-description">{profile.description}</p>}

        <div className="chat-user-badges">
          {badgeAssets.map((badge) => (
            <button type="button" className="chat-card-badge" key={badge.key}
              data-chat-card-label={badge.title} aria-label={badge.title}>
              <ChatBadge badge={badge} />
            </button>
          ))}
          {badgeKeys.map((badgeKey) => {
            const badge = badges.get(badgeKey);
            return badge ? (
              <button type="button" className="chat-card-badge" key={badgeKey}
                data-chat-card-label={badge.title} aria-label={badge.title}>
                <ChatBadge badge={badge} />
              </button>
            ) : null;
          })}
        </div>

        <dl>
          <div>
            <dt>Account created</dt>
            <dd>{profile ? formatDate(profile.createdAt) : error ? "Unavailable" : "Loading…"}</dd>
          </div>
          <div>
            <dt>Following since</dt>
            <dd>
              {profile?.subage
                ? profile.subage.followingSince
                  ? formatDate(profile.subage.followingSince)
                  : "Not following"
                : profile?.relationship
                  ? profile.relationship.isFollowing
                    ? formatDate(profile.relationship.followedAt)
                    : "Not following"
                : profile
                  ? "Unavailable"
                  : error
                    ? "Unavailable"
                    : "Loading…"}
            </dd>
          </div>
          <div>
            <dt>Subscription</dt>
            <dd>{profile ? subscriptionText : (badgeSubscription ?? (error ? "Unavailable" : "Loading…"))}</dd>
          </div>
        </dl>

        {error && <p className="chat-user-error">{error}</p>}

        <div className="chat-user-actions">
          <button
            aria-pressed={blocked}
            className={blocked ? "chat-user-block blocked" : "chat-user-block"}
            onClick={() => {
              void (blocked ? unblockChatter(login) : blockChatter(login));
            }}
            title={
              blocked
                ? `Show @${login}'s messages again`
                : `Hide @${login}'s messages in VioletWire`
            }
            type="button"
          >
            {blocked ? <Undo2 size={14} /> : <Ban size={14} />}
            {blocked ? "Unblock" : "Block"}
          </button>
          {/* Said plainly, because a viewer could reasonably expect this to
              reach their Twitch account, and it does not. */}
          <small>Hides their messages in VioletWire only.</small>
        </div>

        <div className="chat-user-message-heading">
          <span>
            <MessageSquare size={14} /> Messages in current chat
          </span>
          <small>{userMessages.length}</small>
        </div>
        <div
          className="chat-user-messages"
          onScroll={() => {
            const host = messagesHost.current;
            if (!host) return;
            // Incoming messages also scroll this host. Follow the emote instead
            // of dismissing its label before the two-second timer finishes.
            const anchor = labelAnchor.current;
            if (anchor && host.contains(anchor)) {
              setLabel((current) => current ? positionLabel(anchor, current.name) : null);
            }
            stickToNewest.current =
              host.scrollHeight - host.scrollTop - host.clientHeight < 24;
          }}
          ref={messagesHost}
        >
          {userMessages.length === 0 ? (
            <p>No retained messages.</p>
          ) : (
            userMessages.map((message) => (
              <UserCardMessage key={message.id} message={message} renderText={renderText} />
            ))
          )}
        </div>
      {label && createPortal(
        <div className="violetwire-react-tooltip chat-card-label" role="tooltip"
          style={{ left: label.left, top: label.top, transform: "translate(-50%, -100%)",
            maxWidth: `${Math.max(80, Math.min(label.left, view.innerWidth - label.left) * 2 - 16)}px`,
          }}>
          {label.name}
        </div>, root.body,
      )}
    </section>,
    root.body,
  );
}
