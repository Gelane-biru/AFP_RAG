# evaluate_rag.py
import requests
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import os
from collections import defaultdict
import re

# Configuration for connecting to your RAG API
RAG_API_URL = "http://localhost:8000/rag_query"
METRICS_DIR = "metrics"
TEST_DATA_PATH = "test_queries.csv" # Create this file with test queries and expected answers

# Ensure metrics directory exists
os.makedirs(METRICS_DIR, exist_ok=True)

def load_test_data(file_path):
    """Loads test queries from a CSV file."""
    try:
        df = pd.read_csv(file_path)

        if 'query' not in df.columns:
            raise ValueError(f"'{file_path}' must contain a 'query' column.")
        if 'expected_response_keywords' not in df.columns:
            df['expected_response_keywords'] = ''
        if 'expected_language' not in df.columns:
            df['expected_language'] = ''
        if 'ground_truth_document_source' not in df.columns:
            df['ground_truth_document_source'] = '' 

        return df
    except FileNotFoundError:
        print(f"Error: Test data file not found at {file_path}. Please create it.")
        print("Example 'test_queries.csv' content:")
        print("query,expected_response_keywords,expected_language,ground_truth_document_source")
        print("What is polio?,vaccine,en,polio_faq.pdf")
        print("AFP ምንድን ነው?,am,afp_doc_amharic.docx")
        print("Polio maal jechuudha?,turuur,om,polio_info_oromo.pdf")
        return pd.DataFrame() 

def run_queries_and_collect_metrics(test_queries_df):
    """Sends queries to the RAG system and collects data for evaluation."""
    results = []
    for index, row in test_queries_df.iterrows():
        query = row['query']
        expected_keywords = [k.strip().lower() for k in str(row['expected_response_keywords']).split(',') if k.strip()]
        expected_language = row['expected_language'] if pd.notna(row['expected_language']) else None
        ground_truth_source = row['ground_truth_document_source'] if pd.notna(row['ground_truth_document_source']) else None

        payload = {"query": query}
        if expected_language:
            payload["preferred_language"] = expected_language

        try:
            response = requests.post(RAG_API_URL, json=payload)
            response.raise_for_status() # Raise an exception for HTTP errors
            data = response.json()

            # Assess response relevance (simple keyword check)
            response_text_lower = data.get('response', '').lower()
            relevance_score = sum(1 for keyword in expected_keywords if keyword in response_text_lower)
            is_relevant = relevance_score > 0 if expected_keywords else None # If no keywords, relevance is not applicable

            # Assess retrieval accuracy (check if ground truth document was retrieved)
            retrieved_sources = [m.get('source') for m in data.get('retrieved_metadatas', [])]
            retrieval_success = ground_truth_source in retrieved_sources if ground_truth_source else None

            results.append({
                "query": query,
                "detected_language": data.get('detected_language'),
                "response_length": len(data.get('response', '')),
                "retrieved_documents_count": len(data.get('retrieved_documents', [])),
                "retrieved_sources": retrieved_sources,
                "response_text": data.get('response', ''),
                "is_relevant": is_relevant,
                "retrieval_success": retrieval_success,
                "expected_language": expected_language,
                "ground_truth_source": ground_truth_source
            })
        except requests.exceptions.RequestException as e:
            print(f"Error querying RAG system for '{query}': {e}")
            results.append({
                "query": query,
                "detected_language": "Error",
                "response_length": 0,
                "retrieved_documents_count": 0,
                "retrieved_sources": [],
                "response_text": "Error",
                "is_relevant": False,
                "retrieval_success": False,
                "expected_language": expected_language,
                "ground_truth_source": ground_truth_source
            })
    return pd.DataFrame(results)

def visualize_language_detection(df):
    """Generates a bar chart for detected language distribution."""
    if 'detected_language' not in df.columns or df['detected_language'].empty:
        print("No language detection data to visualize.")
        return

    plt.figure(figsize=(10, 6))
    sns.countplot(data=df, y='detected_language', order=df['detected_language'].value_counts().index, palette='viridis')
    plt.title('Distribution of Detected Languages')
    plt.xlabel('Number of Queries')
    plt.ylabel('Detected Language')
    plt.tight_layout()
    plt.savefig(os.path.join(METRICS_DIR, 'language_detection_distribution.png'))
    plt.close()
    print(f"Generated: {os.path.join(METRICS_DIR, 'language_detection_distribution.png')}")

def visualize_retrieval_sources(df):
    """Generates a bar chart for the frequency of retrieved document sources."""
    if 'retrieved_sources' not in df.columns or df['retrieved_sources'].empty:
        print("No retrieved sources data to visualize.")
        return

    all_sources = []
    for sources_list in df['retrieved_sources']:
        all_sources.extend(sources_list)

    if not all_sources:
        print("No documents were retrieved across queries to visualize.")
        return

    source_counts = pd.Series(all_sources).value_counts()

    plt.figure(figsize=(12, 7))
    sns.barplot(x=source_counts.values, y=source_counts.index, palette='magma')
    plt.title('Frequency of Retrieved Document Sources')
    plt.xlabel('Number of Times Retrieved')
    plt.ylabel('Document Source')
    plt.tight_layout()
    plt.savefig(os.path.join(METRICS_DIR, 'retrieved_document_sources.png'))
    plt.close()
    print(f"Generated: {os.path.join(METRICS_DIR, 'retrieved_document_sources.png')}")

def visualize_response_length_distribution(df):
    """Generates a histogram of response lengths."""
    if 'response_length' not in df.columns or df['response_length'].empty:
        print("No response length data to visualize.")
        return

    plt.figure(figsize=(10, 6))
    sns.histplot(df['response_length'], bins=20, kde=True, color='skyblue')
    plt.title('Distribution of Response Lengths')
    plt.xlabel('Response Length (Characters)')
    plt.ylabel('Frequency')
    plt.tight_layout()
    plt.savefig(os.path.join(METRICS_DIR, 'response_length_distribution.png'))
    plt.close()
    print(f"Generated: {os.path.join(METRICS_DIR, 'response_length_distribution.png')}")

def visualize_retrieval_success_by_language(df):
    """Generates a bar chart showing retrieval success rate grouped by expected language."""
    if 'retrieval_success' not in df.columns or df['retrieval_success'].isnull().all():
        print("No retrieval success data for language-based visualization.")
        return

    # Filter out entries where ground_truth_source was not provided
    df_filtered = df[df['ground_truth_source'].notna()].copy()
    if df_filtered.empty:
        print("No queries with ground truth sources to evaluate retrieval success by language.")
        return

    # Convert boolean to int for mean calculation (True=1, False=0)
    df_filtered['retrieval_success_int'] = df_filtered['retrieval_success'].astype(int)

    success_rates = df_filtered.groupby('expected_language')['retrieval_success_int'].mean().reset_index()
    success_rates['retrieval_success_percentage'] = success_rates['retrieval_success_int'] * 100

    plt.figure(figsize=(10, 6))
    sns.barplot(x='expected_language', y='retrieval_success_percentage', data=success_rates, palette='coolwarm')
    plt.title('Retrieval Success Rate by Expected Language')
    plt.xlabel('Expected Language')
    plt.ylabel('Retrieval Success Rate (%)')
    plt.ylim(0, 100)
    plt.tight_layout()
    plt.savefig(os.path.join(METRICS_DIR, 'retrieval_success_by_language.png'))
    plt.close()
    print(f"Generated: {os.path.join(METRICS_DIR, 'retrieval_success_by_language.png')}")

def visualize_relevance_vs_retrieval(df):
    """Generates a scatter plot or similar to show relationship between retrieval success and relevance."""
    if 'is_relevant' not in df.columns or 'retrieval_success' not in df.columns:
        print("Missing 'is_relevant' or 'retrieval_success' columns for this visualization.")
        return

    df_filtered = df[df['is_relevant'].notna() & df['retrieval_success'].notna()].copy()
    if df_filtered.empty:
        print("No complete data points for relevance vs. retrieval visualization.")
        return

    # Convert booleans to strings for better categorization in hue
    df_filtered['is_relevant_str'] = df_filtered['is_relevant'].map({True: 'Relevant', False: 'Not Relevant'})
    df_filtered['retrieval_success_str'] = df_filtered['retrieval_success'].map({True: 'Retrieval Success', False: 'Retrieval Failure'})

    # Create a count plot to visualize combinations
    plt.figure(figsize=(10, 6))
    sns.countplot(data=df_filtered, x='retrieval_success_str', hue='is_relevant_str', palette='Paired')
    plt.title('Query Outcomes: Retrieval Success vs. Response Relevance')
    plt.xlabel('Retrieval Outcome')
    plt.ylabel('Number of Queries')
    plt.legend(title='Response Relevance')
    plt.tight_layout()
    plt.savefig(os.path.join(METRICS_DIR, 'relevance_vs_retrieval.png'))
    plt.close()
    print(f"Generated: {os.path.join(METRICS_DIR, 'relevance_vs_retrieval.png')}")


def print_summary_statistics(df):
    """Prints basic summary statistics of the evaluation."""
    print("\n--- Evaluation Summary Statistics ---")
    if 'detected_language' in df.columns and not df['detected_language'].empty:
        print("\nDetected Language Counts:")
        print(df['detected_language'].value_counts())

    if 'retrieved_documents_count' in df.columns and not df['retrieved_documents_count'].empty:
        print("\nRetrieved Documents Count (per query):")
        print(df['retrieved_documents_count'].describe())

    if 'response_length' in df.columns and not df['response_length'].empty:
        print("\nResponse Length (characters):")
        print(df['response_length'].describe())

    if 'is_relevant' in df.columns and not df['is_relevant'].isnull().all():
        num_relevant = df['is_relevant'].sum()
        num_irrelevant = (df['is_relevant'] == False).sum()
        total_eval_relevant = num_relevant + num_irrelevant
        if total_eval_relevant > 0:
            print(f"\nResponse Relevance (based on keywords):")
            print(f"  Number of Relevant Responses: {num_relevant}")
            print(f"  Number of Irrelevant Responses: {num_irrelevant}")
            print(f"  Relevance Rate: {num_relevant / total_eval_relevant:.2f}")

    if 'retrieval_success' in df.columns and not df['retrieval_success'].isnull().all():
        num_retrieved_successfully = df['retrieval_success'].sum()
        num_retrieval_failed = (df['retrieval_success'] == False).sum()
        total_eval_retrieval = num_retrieved_successfully + num_retrieval_failed
        if total_eval_retrieval > 0:
            print(f"\nRetrieval Success (based on ground truth source):")
            print(f"  Number of Successful Retrievals: {num_retrieved_successfully}")
            print(f"  Number of Failed Retrievals: {num_retrieval_failed}")
            print(f"  Retrieval Success Rate: {num_retrieved_successfully / total_eval_retrieval:.2f}")

    print("\n--- End of Summary ---")


if __name__ == "__main__":
    print(f"Loading test data from {TEST_DATA_PATH}...")
    test_data = load_test_data(TEST_DATA_PATH)

    if not test_data.empty:
        print("Running queries and collecting metrics...")
        metrics_df = run_queries_and_collect_metrics(test_data)

        if not metrics_df.empty:
            print("Generating visualizations...")
            visualize_language_detection(metrics_df)
            visualize_retrieval_sources(metrics_df)
            visualize_response_length_distribution(metrics_df)
            visualize_retrieval_success_by_language(metrics_df)
            visualize_relevance_vs_retrieval(metrics_df) # New visualization

            print_summary_statistics(metrics_df)
            print(f"All visualizations saved in the '{METRICS_DIR}' directory.")
        else:
            print("No metrics collected. Check RAG API availability and test data.")
    else:
        print("Exiting due to missing or empty test data.")
        