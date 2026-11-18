import { Fragment } from "react";

import { CommandBox } from "./components/command-box";
import { Editor, Tok } from "./components/editor";
import { Lockup } from "./components/lockup";
import { Prompt } from "./components/prompt";
import { command } from "./links";
import { Nav } from "./share-page";
import "./share.css";

const errorComment = "// link is damaged or cut short. skill issue";

/** Shown for a link that does not decode. It sends the visitor to get a fresh roast. */
export const BrokenLinkPage = () => (
  <main className="share broken">
    <Nav />
    <section className="hero">
      <div className="hero-text">
        <Prompt />
        <Lockup lines={["this roast is broken.", `Run ${command}`]} />
        <p className="statement">
          Even the roast gave up. Make a new one: <CommandBox />
        </p>
      </div>
      <div className="stage">
        <Editor
          file="link.ts"
          label="link.ts: decoding the Share Link failed because the link is damaged or cut short."
          lines={[
            <Fragment key="decode">
              <Tok kind="key">const</Tok> <Tok kind="prop">month</Tok> ={" "}
              <Tok kind="prop">decode</Tok>(<Tok kind="prop">link</Tok>);
            </Fragment>,
            <Tok key="error" kind="err">
              {errorComment}
            </Tok>,
          ]}
        />
      </div>
    </section>
  </main>
);
