export interface HnPost {
    id: number;
    title: string;
    url: string;
    score: number;
    by: string;
    comments: number;
    postedAt: string;
    hnLink: string;
  }
  
export interface HnRawStory {
    id: number;
    title: string;
    url?: string;
    score: number;
    by: string;
    descendants?: number;
    time: number;
    type: string;
  }



// StoredPost: what we actually persist in MongoDB.
// Extends HnPost with AI scoring fields that get added during curation.
// Fields optional because a freshly fetched post doesn't have scores yet.
export interface StoredPost extends HnPost {
    aiScore?: number;
    reasoning?: string;
    consistencyConfidence?: number; // only present on posts that went through self-consistency
    embedding?: number[];           // added Day 2
    enrichment?: PostEnrichment;    // added Day 4
    fetchedAt: Date;                // when this post was retrieved from HN API
    sentAt?: Date;                  // when this post was included in an email
  }
  
  // PostEnrichment: will add it later, defined here so the StoredPost type is stable.
export interface PostEnrichment {
    keyInsight: string;
    controversyScore: number;
    consensusView: string;
    commentHighlight: string;
    enrichedAt: Date;
  }


// ScoredPost: HnPost with AI scoring fields added.
// Returned by curateAndRank so the caller has everything in one object.
export interface ScoredPost extends HnPost {
    aiScore: number;
    reasoning: string;
    consistencyConfidence?: number;
  }
  
  // FScoreResponse: the shape Fireworks returns for each post in batch scoring.
export interface BatchScoreResponse {
    id: number;
    score: number;
    reasoning: string;
  }
  
  // ConsistencyScoreJson: self-consistency runs use Fireworks JSON object mode.
export interface ConsistencyScoreJson {
    score: number;
    confidence?: number;
  }