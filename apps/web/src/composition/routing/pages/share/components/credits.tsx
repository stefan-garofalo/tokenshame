import { pictures } from "../pictures";

/** The credit line for the found pictures, as their licences ask. */
export const Credits = () => (
  <p className="credits">
    Pictures:{" "}
    {[...pictures.values()].map(({ author, licence, licenceUrl, page, title }, index) => (
      <span key={page}>
        {index > 0 && "; "}
        <a href={page} rel="noreferrer">
          “{title}”
        </a>{" "}
        by {author}, <a href={licenceUrl}>{licence}</a>, via Wikimedia Commons
      </span>
    ))}
    .
  </p>
);
